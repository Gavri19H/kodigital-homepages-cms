// Round-4 P2a — A-4 composed condition groups ({match:'all'|'any', conditions})
// + 10C ctx-field plumbing (the ctx describes are appended with the engine leg).
//
// PARITY BY CONSTRUCTION: the client evaluator (runtime/dependencies.ts
// conditionMet) and the server money-path evaluator (payload.ts conditionalMet)
// carry byte-identical group dispatch, so a single table drives BOTH sides and
// every cell asserts client === server === the independently-aggregated
// all/any of the per-leg bare results. Back-compat: a bare single-object
// conditional takes the unchanged legacy path (a 1-element all-group equals it).

import { describe, expect, it } from "vitest";
import {
  conditionMet,
  isConditionGroup,
  buildCtxFields,
  evaluateComponents,
} from "../src/public/leadgen/runtime/dependencies";
import {
  LgStateStore,
  type LgStateAdapters,
  type LgStorageAdapter,
  type LgComponentConfig,
} from "../src/public/leadgen/runtime/state";
import { evaluateDependencies } from "../src/leadgen/dependencies";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  conditionalMet,
  isPayloadConditionGroup,
  type LeadgenPayloadConditional,
  type LeadgenPayloadConditionGroup,
} from "../src/leadgen/payload";

// ---------------------------------------------------------------------------
// Table: one bare conditional per op (+ a missing-answer leg), a spread of
// answer maps (incl. string-coercion edges + all-absent), and every pairwise
// all/any composition over them.
// ---------------------------------------------------------------------------

const BARE: LeadgenPayloadConditional[] = [
  { when: "a", op: "eq", value: 1 },
  { when: "a", op: "neq", value: 2 },
  { when: "b", op: "gt", value: 10 },
  { when: "b", op: "lt", value: 100 },
  { when: "b", op: "gte", value: 25 },
  { when: "b", op: "lte", value: 25 },
  { when: "b", op: "range", from: 5, to: 50 },
  { when: "c", op: "in", values: ["x", "y"] },
  { when: "c", op: "not_in", values: ["z"] },
  { when: "missing", op: "eq", value: 1 }, // unanswered `when` → always false
];

const ANSWER_MAPS: Array<Record<string, unknown>> = [
  {}, // all absent
  { a: 1, b: 25, c: "x" },
  { a: 2, b: 200, c: "z" },
  { a: 1, b: 5, c: "y" },
  { a: "1", b: "25", c: "x" }, // Number()-coercion + string membership edges
  { a: true, b: 0, c: "" },
];

// Build every 2-condition all/any group, plus a few 1- and 3-condition groups.
function allGroups(): LeadgenPayloadConditionGroup[] {
  const groups: LeadgenPayloadConditionGroup[] = [];
  for (let i = 0; i < BARE.length; i++) {
    for (let j = i + 1; j < BARE.length; j++) {
      const bi = BARE[i] as LeadgenPayloadConditional;
      const bj = BARE[j] as LeadgenPayloadConditional;
      groups.push({ match: "all", conditions: [bi, bj] });
      groups.push({ match: "any", conditions: [bi, bj] });
    }
  }
  // 1-element groups (both matches) + one 3-element group + a match-absent group.
  const b0 = BARE[0] as LeadgenPayloadConditional;
  const b2 = BARE[2] as LeadgenPayloadConditional;
  const b7 = BARE[7] as LeadgenPayloadConditional;
  groups.push({ match: "all", conditions: [b0] });
  groups.push({ match: "any", conditions: [b0] });
  groups.push({ match: "all", conditions: [b0, b2, b7] });
  groups.push({ match: "any", conditions: [b0, b2, b7] });
  groups.push({ conditions: [b0, b2] } as LeadgenPayloadConditionGroup); // match absent → AND
  return groups;
}

// Independent expected: aggregate the per-leg BARE results (the bare path is
// covered cell-for-cell by leadgen-runtime-engine.test.ts's parity table).
function expectedGroup(g: LeadgenPayloadConditionGroup, answers: Record<string, unknown>): boolean {
  const legs = g.conditions.map((c) => conditionMet(c, answers));
  return g.match === "any" ? legs.some((x) => x) : legs.every((x) => x);
}

describe("P2a A-4: composed condition groups — client↔server parity + all/any semantics", () => {
  it("client conditionMet === server conditionalMet === all/any aggregate, over every group × answer map", () => {
    const groups = allGroups();
    let cells = 0;
    for (const g of groups) {
      for (const answers of ANSWER_MAPS) {
        const expected = expectedGroup(g, answers);
        const client = conditionMet(g, answers);
        const server = conditionalMet(g, answers);
        if (client !== server || client !== expected) {
          throw new Error(
            `group mismatch: match=${g.match ?? "(absent)"} n=${g.conditions.length} ` +
              `answers=${JSON.stringify(answers)} client=${String(client)} ` +
              `server=${String(server)} expected=${String(expected)}`,
          );
        }
        cells += 1;
      }
    }
    // 2-combos ×2 matches + 5 extra groups, × the answer maps.
    const twoCombos = (BARE.length * (BARE.length - 1)) / 2; // 45
    const expectedGroups = twoCombos * 2 + 5; // 95
    expect(groups.length).toBe(expectedGroups);
    expect(cells).toBe(expectedGroups * ANSWER_MAPS.length);
  });

  it("empty conditions follows every/some: all ⇒ true, any ⇒ false (both sides)", () => {
    const emptyAll: LeadgenPayloadConditionGroup = { match: "all", conditions: [] };
    const emptyAny: LeadgenPayloadConditionGroup = { match: "any", conditions: [] };
    expect(conditionMet(emptyAll, {})).toBe(true);
    expect(conditionalMet(emptyAll, {})).toBe(true);
    expect(conditionMet(emptyAny, {})).toBe(false);
    expect(conditionalMet(emptyAny, {})).toBe(false);
  });

  it("match absent defaults to AND (every)", () => {
    const g = {
      conditions: [
        { when: "a", op: "eq", value: 1 },
        { when: "b", op: "eq", value: 2 },
      ],
    } as LeadgenPayloadConditionGroup;
    expect(conditionMet(g, { a: 1, b: 2 })).toBe(true);
    expect(conditionMet(g, { a: 1, b: 9 })).toBe(false); // AND, not OR
    expect(conditionalMet(g, { a: 1, b: 9 })).toBe(false);
  });

  it("missing-answer leg is fail-closed inside a group (never throws, never blocks)", () => {
    const g: LeadgenPayloadConditionGroup = {
      match: "all",
      conditions: [
        { when: "present", op: "eq", value: 1 },
        { when: "missing", op: "eq", value: 1 },
      ],
    };
    // present=1 true, missing → false ⇒ AND false; ANY of the two → true.
    expect(conditionMet(g, { present: 1 })).toBe(false);
    expect(conditionMet({ ...g, match: "any" }, { present: 1 })).toBe(true);
    expect(() => conditionMet(g, { present: 1 })).not.toThrow();
  });
});

describe("P2a A-4: back-compat — bare conditional unchanged", () => {
  it("a bare single-object conditional evaluates identically to a 1-element all-group, for every op × answer map", () => {
    let cells = 0;
    for (const bare of BARE) {
      for (const answers of ANSWER_MAPS) {
        const asGroup: LeadgenPayloadConditionGroup = { match: "all", conditions: [bare] };
        const bareC = conditionMet(bare, answers);
        const bareS = conditionalMet(bare, answers);
        expect(bareC).toBe(bareS); // bare parity (unchanged legacy path)
        expect(conditionMet(asGroup, answers)).toBe(bareC); // group wrapping is transparent
        expect(conditionalMet(asGroup, answers)).toBe(bareS);
        cells += 1;
      }
    }
    expect(cells).toBe(BARE.length * ANSWER_MAPS.length);
  });

  it("shape detectors: group iff an array `conditions`; bare/primitive/null/array are not groups (client === server guard)", () => {
    const group: unknown = { match: "any", conditions: [] };
    const bare: unknown = { when: "a", op: "eq", value: 1 };
    for (const v of [group, bare, null, undefined, 5, "x", [], { conditions: "no" }, {}]) {
      expect(isConditionGroup(v)).toBe(isPayloadConditionGroup(v));
    }
    expect(isConditionGroup(group)).toBe(true);
    expect(isConditionGroup(bare)).toBe(false);
    expect(isConditionGroup({ conditions: [] })).toBe(true); // structural: array conditions
    expect(isConditionGroup(null)).toBe(false);
    expect(isConditionGroup([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10C ctx-field plumbing — the client leg (the /lg/attempt ctx emission is a
// P3/P4 server seam; here __state/__device degrade to absent = fail-closed).
// ---------------------------------------------------------------------------

function memStore(): LgStateStore {
  const backing = new Map<string, string>();
  const storage: LgStorageAdapter = {
    get: (k) => (backing.has(k) ? (backing.get(k) as string) : null),
    set: (k, v) => void backing.set(k, v),
    remove: (k) => void backing.delete(k),
    keys: () => [...backing.keys()],
  };
  const adapters: LgStateAdapters = { storage, now: () => 1_700_000_000_000 };
  const store = new LgStateStore(adapters);
  store.bindIdentity({
    session_id: "s",
    page_view_id: "p",
    funnel_attempt_id: "att_1",
    signed_config_token: "tok",
    tuple: { funnel_variant_id: "v", section_order_hash: "h", content_version: 1 },
  });
  return store;
}

describe("P2a 10C: ctx fields build + evaluate in conditions", () => {
  it("buildCtxFields emits only __-prefixed keys; state/device present only when supplied", () => {
    const now = new Date(2026, 6, 20, 9, 30, 0); // Mon 2026-07-20 09:30 local (getDay()===1)
    const withCtx = buildCtxFields({ page: 2, now, state: "CA", device: "mobile" });
    expect(withCtx).toEqual({ __page: 2, __hour: 9, __weekday: 1, __state: "CA", __device: "mobile" });
    for (const k of Object.keys(withCtx)) expect(k.startsWith("__")).toBe(true);

    // Absent/blank geo → those keys omitted (degrade: a rule on them is false).
    const noGeo = buildCtxFields({ page: 0, now });
    expect(noGeo).toEqual({ __page: 0, __hour: 9, __weekday: 1 });
    expect("__state" in noGeo).toBe(false);
    expect("__device" in noGeo).toBe(false);
    expect(buildCtxFields({ page: 0, now, state: "", device: "" })).toEqual({
      __page: 0,
      __hour: 9,
      __weekday: 1,
    });
  });

  it("a __page/__hour condition is FALSE against the plain answer map but TRUE against the ctx-merged map (fail-before/pass-after)", () => {
    const store = memStore();
    store.recordUserAnswer("age", 40, { question_id: "q", section_public_id: "s" });
    const plain = store.answerValues();
    const merged = { ...plain, ...buildCtxFields({ page: 3, now: new Date(2026, 6, 20, 14, 0, 0) }) };

    const fromPage2 = { when: "__page", op: "gte", value: 2 } as LeadgenPayloadConditional;
    const afternoon = { when: "__hour", op: "gte", value: 12 } as LeadgenPayloadConditional;
    // BEFORE (no ctx merge): the __ key is absent ⇒ fail-closed false.
    expect(conditionMet(fromPage2, plain)).toBe(false);
    expect(conditionMet(afternoon, plain)).toBe(false);
    // AFTER (ctx merged): evaluates; real answers still evaluate too.
    expect(conditionMet(fromPage2, merged)).toBe(true);
    expect(conditionMet(afternoon, merged)).toBe(true);
    expect(conditionMet({ when: "age", op: "gte", value: 18 } as LeadgenPayloadConditional, merged)).toBe(true);
    // A composed group mixing a ctx field and an answer field (client === server).
    const grp: LeadgenPayloadConditionGroup = {
      match: "all",
      conditions: [fromPage2, { when: "age", op: "gte", value: 18 }],
    };
    expect(conditionMet(grp, merged)).toBe(true);
    expect(conditionalMet(grp, merged)).toBe(true);
    // __state fail-closed until the server supplies it.
    expect(conditionMet({ when: "__state", op: "eq", value: "CA" } as LeadgenPayloadConditional, merged)).toBe(false);
  });
});

describe("P2a 10C GUARD: ctx keys never enter the auction/S2S projection or persistence", () => {
  it("__ keys live only in the eval map — auctionAnswers + serialize read the store and exclude them", () => {
    const store = memStore();
    store.recordUserAnswer("age", 40, { question_id: "q", section_public_id: "s1" });
    store.recordUserAnswer("state", "CA", { question_id: "q2", section_public_id: "s1" });

    // Merge ctx for evaluation — a SEPARATE transient object.
    const merged = {
      ...store.answerValues(),
      ...buildCtxFields({ page: 5, now: new Date(2026, 6, 20, 8, 0, 0), state: "CA", device: "mobile" }),
    };
    expect(merged["__page"]).toBe(5); // ctx present in the eval map

    // Projection (auction/S2S) reads the STORE, not the eval map.
    const projected = store.auctionAnswers(new Set());
    const projectedKeys = Object.keys(projected).sort();
    expect(projectedKeys).toEqual(["age", "state"]); // note the answer field is "state", NOT "__state"
    for (const k of projectedKeys) expect(k.startsWith("__")).toBe(false);

    // Persistence snapshot likewise carries no __ key.
    const snap = JSON.parse(store.serialize(new Set())) as { answers: Record<string, unknown> };
    for (const k of Object.keys(snap.answers)) expect(k.startsWith("__")).toBe(false);

    // Merging ctx never mutated the store (the structural guarantee).
    expect(Object.keys(store.answerValues()).some((k) => k.startsWith("__"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix round — seam #2: server requiredNow group parity
// (api/src/leadgen/dependencies.ts:99, pre-fix). The server's `requiredNow`
// gated `props.requiredWhen` on a hand-rolled `"when" in rw && "op" in rw`
// probe that only recognized the BARE conditional shape — a composed
// requiredWhen silently fell through to `return false`, so a component
// authored "required when GROUP is met" was NEVER required_now server-side
// (continue_blocked / the studio dependency preview), while the client's
// requiredNow (runtime/dependencies.ts, unaffected by this bug) correctly
// evaluated the SAME group — a client/server divergence on the money path.
// THE FIX: the guard now also accepts the composed shape via the SAME
// structural detector payload.ts and the client evaluator use
// (isPayloadConditionGroup) — no second, divergent detector — and routes it
// through the identical `conditionalMet` dispatch.
// ---------------------------------------------------------------------------

describe("P2a fix — server requiredNow group parity (seam #2)", () => {
  it("FAIL-BEFORE / PASS-AFTER: the pre-fix bare-only guard would reject a composed requiredWhen; the real server path now honors it", () => {
    const composedRequiredWhen: LeadgenPayloadConditionGroup = {
      match: "all",
      conditions: [
        { when: "home_own", op: "eq", value: "yes" },
        { when: "home_value", op: "gte", value: 500000 },
      ],
    };

    // BEFORE: the exact pre-fix guard predicate (api/src/leadgen/dependencies.ts
    // :99, reproduced verbatim — it no longer exists in production, since this
    // fix replaced it). It recognizes ONLY a bare {when,op} shape directly on
    // requiredWhen, so it rejects any composed group outright.
    const preFixGuardShape = (rw: unknown): boolean =>
      rw !== null && rw !== undefined && typeof rw === "object" && "when" in rw && "op" in rw;
    expect(preFixGuardShape(composedRequiredWhen), "pre-fix guard never even recognizes the group shape").toBe(
      false,
    );

    const nodes = [
      {
        type: "FreeTextQuestion",
        question_id: "q_notes",
        internal_field: "notes",
        props: { requiredWhen: composedRequiredWhen },
      },
    ];
    const met = { home_own: "yes", home_value: 750000 };
    const unmet = { home_own: "yes", home_value: 100000 };
    const missing = {};

    // AFTER: the REAL production path (evaluateDependencies -> requiredNow ->
    // isConditionalSlotShape -> isConditionMet -> conditionalMet) now agrees
    // with the group semantics on every leg.
    expect(evaluateDependencies(nodes as unknown as LeadgenComponentNode[], met).components[0]?.required_now).toBe(
      true,
    );
    expect(
      evaluateDependencies(nodes as unknown as LeadgenComponentNode[], unmet).components[0]?.required_now,
    ).toBe(false);
    expect(
      evaluateDependencies(nodes as unknown as LeadgenComponentNode[], missing).components[0]?.required_now,
    ).toBe(false);
  });

  it("evaluateDependencies (server) required_now agrees with evaluateComponents (client) required_now for a composed requiredWhen, over all/any x met/unmet/missing-answer", () => {
    const REQUIRED_WHEN_CONDITIONS: LeadgenPayloadConditional[] = [
      { when: "a", op: "eq", value: 1 },
      { when: "b", op: "gte", value: 10 },
    ];
    const MATCHES: Array<"all" | "any"> = ["all", "any"];
    const ANSWER_LEGS: Array<{ label: string; answers: Record<string, unknown> }> = [
      { label: "both met", answers: { a: 1, b: 10 } },
      { label: "one met (a only)", answers: { a: 1, b: 0 } },
      { label: "one met (b only)", answers: { a: 0, b: 25 } },
      { label: "none met", answers: { a: 0, b: 0 } },
      { label: "all answers missing", answers: {} },
    ];

    let cells = 0;
    for (const match of MATCHES) {
      const requiredWhen: LeadgenPayloadConditionGroup = { match, conditions: REQUIRED_WHEN_CONDITIONS };
      const nodes = [
        {
          type: "FreeTextQuestion",
          question_id: "q_rw",
          internal_field: "rw_field",
          props: { requiredWhen },
        },
      ];
      for (const leg of ANSWER_LEGS) {
        const server = evaluateDependencies(nodes as unknown as LeadgenComponentNode[], leg.answers);
        const client = evaluateComponents(nodes as unknown as LgComponentConfig[], leg.answers);
        const serverRN = server.components[0]?.required_now;
        const clientRN = client.components[0]?.required_now;
        const expected =
          match === "any"
            ? REQUIRED_WHEN_CONDITIONS.some((c) => conditionalMet(c, leg.answers))
            : REQUIRED_WHEN_CONDITIONS.every((c) => conditionalMet(c, leg.answers));
        if (serverRN !== clientRN || serverRN !== expected) {
          throw new Error(
            `required_now mismatch: match=${match} leg=${leg.label} ` +
              `server=${String(serverRN)} client=${String(clientRN)} expected=${String(expected)}`,
          );
        }
        cells += 1;
      }
    }
    expect(cells).toBe(MATCHES.length * ANSWER_LEGS.length);
  });

  it("an unconditionally required: true node stays required_now regardless of requiredWhen shape (guard order unaffected)", () => {
    const nodes = [
      {
        type: "FreeTextQuestion",
        question_id: "q_hard",
        internal_field: "hard_field",
        required: true,
        props: { requiredWhen: { match: "all", conditions: [{ when: "never", op: "eq", value: 1 }] } },
      },
    ];
    expect(evaluateDependencies(nodes as unknown as LeadgenComponentNode[], {}).components[0]?.required_now).toBe(
      true,
    );
  });
});
