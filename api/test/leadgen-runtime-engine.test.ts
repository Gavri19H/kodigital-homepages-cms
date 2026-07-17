// LeadGen runtime engine — vitest half of 03 §3.10 (definitions 11 §11.1/11.3).
//
// Tests the DOM-FREE runtime cores DIRECTLY (node env; the runtime modules
// take injected adapters, no DOM globals at import time):
//   * §3.4 state transitions (default_applied → user_confirmed_default /
//     user_selected) + serialization excluding dependency-hidden answers;
//   * validation matrix per client_validation rule type;
//   * the dependency-evaluator PARITY TABLE: the server evaluator
//     (leadgen/dependencies.ts + payload.ts conditionalMet) and the client
//     evaluator (runtime/dependencies.ts) run over the SAME generated case
//     matrix — all 9 ops × edge values incl. type-coercion edges — and must
//     match cell-for-cell (09 §9.3);
//   * beacon batching ≤ 20 (server MAX_LEADGEN_EVENTS_PER_REQUEST) +
//     envelope completeness + bounded retry/backoff (fake timers, horizon
//     WELL under the 10-min KV seen-TTL);
//   * ULID-shape event_id format;
//   * the §3.1 bundle-size gate over the COMMITTED generated bundle.

import { describe, expect, it, vi, afterEach } from "vitest";

// ---- client runtime modules (DOM-free cores) ------------------------------
import {
  LgStateStore,
  parseSnapshot,
  scanForRestorableSnapshot,
  storageKeyForAttempt,
  type LgBindingTuple,
  type LgComponentConfig,
  type LgSectionConfig,
  type LgStorageAdapter,
} from "../src/public/leadgen/runtime/state";
import {
  conditionMet,
  evaluateComponents,
  hiddenAnswerFields,
  isAnswered,
  visibleSectionIndexes,
} from "../src/public/leadgen/runtime/dependencies";
import { validateValue, validateSection } from "../src/public/leadgen/runtime/validation";
import {
  LgBeaconClient,
  ulidLike,
  LG_DEFAULT_RETRY_DELAYS_MS,
  LG_MAX_BATCH,
  type LgBeaconAdapters,
} from "../src/public/leadgen/runtime/events";

// ---- server twins (parity source of truth) --------------------------------
import { evaluateDependencies } from "../src/leadgen/dependencies";
import { conditionalMet, type LeadgenPayloadConditional } from "../src/leadgen/payload";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

// ---- committed bundle (§3.1 size gate) -------------------------------------
import {
  LEADGEN_RUNTIME_JS,
  LEADGEN_RUNTIME_JS_BYTES,
} from "../src/public/leadgen/runtime/engine-bundle.generated";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function memoryStorage(): LgStorageAdapter & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, v);
    },
    remove: (k) => {
      map.delete(k);
    },
    keys: () => [...map.keys()],
  };
}

const TUPLE: LgBindingTuple = {
  funnel_variant_id: "lgn_test1",
  section_order_hash: "hash_abc",
  content_version: 3,
};

function newStore(storage = memoryStorage()): { store: LgStateStore; storage: ReturnType<typeof memoryStorage> } {
  const store = new LgStateStore({ storage, now: () => 1_000 });
  store.bindIdentity({
    session_id: "sid-1",
    page_view_id: "pv-1",
    funnel_attempt_id: "att_01TEST",
    signed_config_token: "tok.secret",
    tuple: TUPLE,
  });
  return { store, storage };
}

const META = { question_id: "q1", section_public_id: "lgs_1" };

function component(partial: Partial<LgComponentConfig>): LgComponentConfig {
  return { type: "SingleChoiceQuestion", question_id: "q1", props: {}, ...partial };
}

// ---------------------------------------------------------------------------
// §3.4 state transitions
// ---------------------------------------------------------------------------

describe("state: §3.4 answer-source transitions", () => {
  it("applies a config default once as default_applied", () => {
    const { store } = newStore();
    const first = store.applyDefault("home_own", "yes", META);
    expect(first?.entry.answer_source).toBe("default_applied");
    expect(first?.transition).toBe("default");
    // applied ONCE — a second apply (re-entering the section) is a no-op
    expect(store.applyDefault("home_own", "no", META)).toBeNull();
    expect(store.getAnswer("home_own")?.value).toBe("yes");
  });

  it("same-value click over a default → user_confirmed_default", () => {
    const { store } = newStore();
    store.applyDefault("home_own", "yes", META);
    const write = store.recordUserAnswer("home_own", "yes", META);
    expect(write.entry.answer_source).toBe("user_confirmed_default");
    expect(write.transition).toBe("confirmed");
  });

  it("different-value click over a default → user_selected", () => {
    const { store } = newStore();
    store.applyDefault("home_own", "yes", META);
    const write = store.recordUserAnswer("home_own", "no", META);
    expect(write.entry.answer_source).toBe("user_selected");
    expect(write.transition).toBe("selected");
  });

  it("user answer re-click stays user_selected; change stays user_selected", () => {
    const { store } = newStore();
    store.recordUserAnswer("age", 30, META);
    const again = store.recordUserAnswer("age", 30, META);
    expect(again.entry.answer_source).toBe("user_selected");
    expect(again.transition).toBe("unchanged");
    const changed = store.recordUserAnswer("age", 31, META);
    expect(changed.entry.answer_source).toBe("user_selected");
    expect(changed.transition).toBe("selected");
  });

  it("default never overwrites a restored/user entry", () => {
    const { store } = newStore();
    store.recordUserAnswer("home_own", "no", META);
    expect(store.applyDefault("home_own", "yes", META)).toBeNull();
    expect(store.getAnswer("home_own")?.answer_source).toBe("user_selected");
  });
});

// ---------------------------------------------------------------------------
// serialization excludes dependency-hidden answers (§3.5.3) + restore tuple
// ---------------------------------------------------------------------------

describe("state: serialization + restore", () => {
  it("excludes dependency-hidden answers from serialization, keeps them in memory", () => {
    const { store } = newStore();
    store.recordUserAnswer("home_own", "no", META);
    store.recordUserAnswer("home_value", 250_000, { ...META, question_id: "q2" });
    // home_value's component is conditional on home_own == "yes" → hidden now
    const hidden = new Set(["home_value"]);
    const parsed = parseSnapshot(store.serialize(hidden));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed?.answers ?? {})).toEqual(["home_own"]);
    // retained in memory for back-nav
    expect(store.getAnswer("home_value")?.value).toBe(250_000);
  });

  it("persists under lg:{funnel_attempt_id} and clears on quote_complete", () => {
    const { store, storage } = newStore();
    store.recordUserAnswer("home_own", "no", META);
    store.persist(new Set());
    expect(storage.map.has(storageKeyForAttempt("att_01TEST"))).toBe(true);
    store.clearPersisted();
    expect(storage.map.has(storageKeyForAttempt("att_01TEST"))).toBe(false);
  });

  it("restore scan adopts a same-tuple snapshot and discards mismatched/corrupt entries", () => {
    const { store, storage } = newStore();
    store.recordUserAnswer("home_own", "no", META);
    store.setSectionIndex(2);
    store.pushBack(0);
    store.persist(new Set());

    storage.set("lg:att_OTHER", JSON.stringify({ v: 1, tuple: { ...TUPLE, content_version: 99 }, section_index: 0, back_stack: [], answers: {}, saved_at: 5 }));
    storage.set("lg:att_CORRUPT", "{not json");

    const hit = scanForRestorableSnapshot(storage, TUPLE);
    expect(hit?.key).toBe(storageKeyForAttempt("att_01TEST"));
    expect(hit?.snapshot.section_index).toBe(2);
    expect(hit?.snapshot.back_stack).toEqual([0]);
    expect(hit?.snapshot.answers["home_own"]?.value).toBe("no");
    // corrupt + stale-tuple entries were deleted by the scan
    expect(storage.map.has("lg:att_OTHER")).toBe(false);
    expect(storage.map.has("lg:att_CORRUPT")).toBe(false);
  });

  it("restore misses on a different binding tuple", () => {
    const { store, storage } = newStore();
    store.recordUserAnswer("home_own", "no", META);
    store.persist(new Set());
    const other: LgBindingTuple = { ...TUPLE, section_order_hash: "hash_zzz" };
    expect(scanForRestorableSnapshot(storage, other)).toBeNull();
  });

  it("snapshot never carries the signed_config_token (§3.4 memory-only)", () => {
    const { store } = newStore();
    store.recordUserAnswer("home_own", "no", META);
    expect(store.serialize(new Set())).not.toContain("tok.secret");
  });
});

// ---------------------------------------------------------------------------
// validation matrix per rule type
// ---------------------------------------------------------------------------

describe("validation: client_validation rule matrix", () => {
  it("required", () => {
    const c = component({ client_validation: { required: true } });
    expect(validateValue(c, undefined, true).map((f) => f.code)).toEqual(["required"]);
    expect(validateValue(c, "", true).map((f) => f.code)).toEqual(["required"]);
    expect(validateValue(c, [], true).map((f) => f.code)).toEqual(["required"]);
    expect(validateValue(c, "x", true)).toEqual([]);
    expect(validateValue(c, 0, true)).toEqual([]); // 0 answers (server isAnswered parity)
    expect(validateValue(c, false, true)).toEqual([]);
  });

  it("optional empty value passes everything", () => {
    const c = component({ client_validation: { min: 5, pattern: "^a" } });
    expect(validateValue(c, "", false)).toEqual([]);
  });

  it("valid_values membership (scalar + multi-select array)", () => {
    const c = component({ client_validation: { valid_values: ["a", "b", 3] } });
    expect(validateValue(c, "a", false)).toEqual([]);
    expect(validateValue(c, 3, false)).toEqual([]);
    expect(validateValue(c, "3", false)).toEqual([]); // DOM string form tolerated
    expect(validateValue(c, "z", false).map((f) => f.code)).toEqual(["invalid_value"]);
    expect(validateValue(c, ["a", "b"], false)).toEqual([]);
    expect(validateValue(c, ["a", "z"], false).map((f) => f.code)).toEqual(["invalid_value"]);
  });

  it("min / max / step", () => {
    const c = component({ client_validation: { min: 10, max: 20, step: 5 } });
    expect(validateValue(c, 10, false)).toEqual([]);
    expect(validateValue(c, "15", false)).toEqual([]); // numeric string coerces
    expect(validateValue(c, 5, false).map((f) => f.code)).toEqual(["min"]); // step-aligned, below min
    expect(validateValue(c, 25, false).map((f) => f.code)).toEqual(["max"]); // step-aligned, above max
    expect(validateValue(c, 12, false).map((f) => f.code)).toEqual(["step"]);
    expect(validateValue(c, 9, false).map((f) => f.code)).toEqual(["min", "step"]); // fails both
    expect(validateValue(c, "abc", false).map((f) => f.code)).toEqual(["invalid_value"]);
  });

  it("step honors the min offset", () => {
    const c = component({ client_validation: { min: 1, step: 3 } });
    expect(validateValue(c, 7, false)).toEqual([]); // 1 + 2*3
    expect(validateValue(c, 8, false).map((f) => f.code)).toEqual(["step"]);
  });

  it("minLength / maxLength", () => {
    const c = component({ client_validation: { minLength: 2, maxLength: 4 } });
    expect(validateValue(c, "ab", false)).toEqual([]);
    expect(validateValue(c, "a", false).map((f) => f.code)).toEqual(["min_length"]);
    expect(validateValue(c, "abcde", false).map((f) => f.code)).toEqual(["max_length"]);
  });

  it("pattern (invalid authored regex degrades to no rule)", () => {
    const good = component({ client_validation: { pattern: "^\\d+$" } });
    expect(validateValue(good, "123", false)).toEqual([]);
    expect(validateValue(good, "12a", false).map((f) => f.code)).toEqual(["pattern"]);
    const broken = component({ client_validation: { pattern: "([" } });
    expect(validateValue(broken, "anything", false)).toEqual([]);
  });

  it("email / phone / ZIP formats by component type", () => {
    const email = component({ type: "EmailInputQuestion" });
    expect(validateValue(email, "user@site.io", false)).toEqual([]);
    expect(validateValue(email, "not-an-email", false).map((f) => f.code)).toEqual([
      "email_format",
    ]);

    const phone = component({ type: "PhoneInputQuestion" });
    // PC-A4 (P4b): phone is now NANP-STRUCTURAL, not strip-count 7..15. A
    // formatted, real-structured number still validates (area + exchange first
    // digit 2–9). The prior fixture "(555) 123-4567" had exchange 123 (first
    // digit 1) — invalid under NANP — so this uses a real exchange (555 → first
    // digit 5). Full false-accept/edge matrix: leadgen-p4b-phone.test.ts.
    expect(validateValue(phone, "(415) 555-1234", false)).toEqual([]);
    expect(validateValue(phone, "123", false).map((f) => f.code)).toEqual(["phone_format"]);

    const zip = component({ type: "ZIPInputQuestion" });
    expect(validateValue(zip, "90210", false)).toEqual([]); // server ZIP_RE parity: 5 digits
    expect(validateValue(zip, "9021", false).map((f) => f.code)).toEqual(["zip_format"]);
    expect(validateValue(zip, "90210-1234", false).map((f) => f.code)).toEqual(["zip_format"]);
  });

  it("validateSection skips hidden components and applies required_now", () => {
    const components = [
      component({ question_id: "q1", internal_field: "a", client_validation: { required: true } }),
      component({ question_id: "q2", internal_field: "b", client_validation: { required: true } }),
    ];
    const visibility = [
      { question_id: "q1", visible: true, required_now: true },
      { question_id: "q2", visible: false, required_now: false }, // hidden → never validated
    ];
    const failures = validateSection(components, {}, visibility);
    expect(failures.map((f) => `${f.internal_field}:${f.code}`)).toEqual(["a:required"]);
  });
});

// ---------------------------------------------------------------------------
// dependency parity table — server evaluator vs client evaluator
// ---------------------------------------------------------------------------

describe("dependencies: server↔client parity (09 §9.3 table)", () => {
  // Edge answer values incl. the Number()-coercion edges the server evaluator
  // exhibits (null→0, ""→0, "25"→25, ["5"]→5, true→1, []→0, "abc"→NaN).
  const ANSWER_VALUES: unknown[] = [
    undefined,
    null,
    0,
    1,
    25,
    64,
    64.5,
    65,
    -3,
    "0",
    "1",
    "25",
    "64.5",
    "",
    " ",
    "abc",
    true,
    false,
    [],
    ["a"],
    ["5"],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { nested: 1 },
  ];

  // All 9 ops with representative + hostile params.
  const CONDITIONALS: LeadgenPayloadConditional[] = [
    { when: "f", op: "eq", value: 1 },
    { when: "f", op: "eq", value: "1" },
    { when: "f", op: "eq", value: true },
    { when: "f", op: "eq", value: null },
    { when: "f", op: "neq", value: 1 },
    { when: "f", op: "neq", value: "yes" },
    { when: "f", op: "gt", value: 25 },
    { when: "f", op: "gt", value: "25" as unknown as number }, // non-number bound
    { when: "f", op: "gt", value: Number.NaN },
    { when: "f", op: "lt", value: 25 },
    { when: "f", op: "gte", value: 25 },
    { when: "f", op: "lte", value: 25 },
    { when: "f", op: "range", from: 25, to: 64 },
    { when: "f", op: "range", from: 25 } as LeadgenPayloadConditional, // missing to
    { when: "f", op: "range", from: "25" as unknown as number, to: 64 },
    { when: "f", op: "in", values: [1, "2", true] },
    { when: "f", op: "in", values: [] },
    { when: "f", op: "in" } as LeadgenPayloadConditional, // missing values
    { when: "f", op: "in", values: [Number.NaN] }, // SameValueZero edge
    { when: "f", op: "not_in", values: [1, "2", true] },
    { when: "f", op: "not_in", values: [] },
    { when: "f", op: "not_in" } as LeadgenPayloadConditional,
    { when: "f", op: "not_in", values: [Number.NaN] },
    { when: "missing_field", op: "eq", value: 1 }, // unanswered `when`
  ];

  it(`matches cell-for-cell over ${CONDITIONALS.length}×${ANSWER_VALUES.length} generated cases`, () => {
    let cells = 0;
    for (const conditional of CONDITIONALS) {
      for (const answer of ANSWER_VALUES) {
        const answers: Record<string, unknown> =
          answer === undefined ? {} : { f: answer };
        const server = conditionalMet(conditional, answers);
        const client = conditionMet(conditional, answers);
        if (server !== client) {
          throw new Error(
            `parity mismatch: op=${conditional.op} answer=${JSON.stringify(answer)} ` +
              `server=${String(server)} client=${String(client)}`,
          );
        }
        cells += 1;
      }
    }
    expect(cells).toBe(CONDITIONALS.length * ANSWER_VALUES.length);
  });
});

// ---------------------------------------------------------------------------
// CONDUCTOR FIX (register PC-12, 2026-07-17) — client-only boolean/string
// equivalence for eq/neq/in/not_in (runtime/dependencies.ts conditionMet).
//
// WHY this is its OWN describe block, not folded into the strict cross-
// product parity table above: that table asserts server===client for every
// cell, and genuinely NEITHER the CONDITIONALS nor the ANSWER_VALUES grids
// contain a "true"/"false" STRING literal — so the fix is a no-op over every
// cell there (verified: this file's own full-grid test still passes
// unmodified). The cases below are the ones that grid deliberately never
// exercised: a LIVE TwoButtonYesNo click records the string "true"/"false"
// (engine.ts handleChoiceActivation — no `choices` array to type-resolve),
// while a studio typed picker (or a defaulted boolean) authors a REAL
// boolean, so both shapes coexist. The CLIENT now normalizes; the SERVER
// (evaluateDependencies / payload.ts conditionalMet) is DELIBERATELY
// unchanged (see runtime/dependencies.ts's module header for the full ruling
// + the flagged, wider-blast-radius follow-up this leaves open). Every
// "NOW MATCHES (was broken)" case below therefore asserts client !== server
// on purpose — that gap is the honest, documented state, not swept under a
// forced-green assertion.
describe("PC-12 conductor fix — boolean/string equivality (client conditionMet only)", () => {
  it("eq: authored BOOLEAN vs a live-recorded STRING answer — client now matches (was broken)", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "eq", value: true };
    const answers = { f: "true" };
    expect(conditionMet(cond, answers), "client: true≡\"true\" now").toBe(true);
    expect(conditionalMet(cond, answers), "server: unchanged, still strict").toBe(false);
  });

  it("eq: authored STRING vs a defaulted BOOLEAN answer — client now matches (was broken)", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "eq", value: "false" };
    const answers = { f: false };
    expect(conditionMet(cond, answers)).toBe(true);
    expect(conditionalMet(cond, answers)).toBe(false);
  });

  it("neq: the SAME logical value in different shapes — client now reports NOT-neq (was wrongly neq)", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "neq", value: "true" };
    const answers = { f: true };
    expect(conditionMet(cond, answers), "client: true≡\"true\" so neq is false").toBe(false);
    expect(conditionalMet(cond, answers), "server: true!==\"true\" (different types) so neq stays true").toBe(true);
  });

  it("neq: genuinely different values in different shapes — BOTH agree (not-equal was never the broken direction)", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "neq", value: "false" };
    const answers = { f: true };
    expect(conditionMet(cond, answers)).toBe(true);
    expect(conditionalMet(cond, answers)).toBe(true);
  });

  it("in: a live-recorded STRING answer against a BOOLEAN-typed values[] — client now matches (was broken)", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "in", values: [true, 5] };
    const answers = { f: "true" };
    expect(conditionMet(cond, answers)).toBe(true);
    expect(conditionalMet(cond, answers)).toBe(false);
  });

  it("not_in: a BOOLEAN answer against a STRING-typed values[] — client now correctly reports 'is in' (was wrongly 'not in')", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "not_in", values: ["false", "other"] };
    const answers = { f: false };
    expect(conditionMet(cond, answers), "client: false is in [\"false\",...] so not_in is false").toBe(false);
    expect(conditionalMet(cond, answers), "server: false!==\"false\" so not_in stays (wrongly) true").toBe(true);
  });

  it("in: NaN SameValueZero membership is preserved (the normalizer must not break the pre-existing edge)", () => {
    const cond: LeadgenPayloadConditional = { when: "f", op: "in", values: [Number.NaN] };
    const answers = { f: Number.NaN };
    expect(conditionMet(cond, answers)).toBe(true);
    expect(conditionalMet(cond, answers)).toBe(true); // unaffected, both agree as before
  });

  it("REGRESSION — same-shape pairs (the 'defaults path' / choice-workaround shape) are UNCHANGED on both sides", () => {
    // Both booleans (a pre-set default matching a typed picker) — worked before, still works.
    expect(conditionMet({ when: "f", op: "eq", value: true }, { f: true })).toBe(true);
    expect(conditionalMet({ when: "f", op: "eq", value: true }, { f: true })).toBe(true);
    // Both strings (the p3a/p4c-rules documented workaround shape) — worked before, still works.
    expect(conditionMet({ when: "f", op: "eq", value: "true" }, { f: "true" })).toBe(true);
    expect(conditionalMet({ when: "f", op: "eq", value: "true" }, { f: "true" })).toBe(true);
  });

  it("REGRESSION — ordinary non-boolean values are completely untouched (no accidental numeric/string coercion)", () => {
    // A numeric answer against a numeric-string conditional value: neither side is boolean-shaped.
    expect(conditionMet({ when: "f", op: "eq", value: "5" }, { f: 5 })).toBe(false);
    expect(conditionalMet({ when: "f", op: "eq", value: "5" }, { f: 5 })).toBe(false);
    // A non-"true"/"false" string against a boolean value: normalizeBoolShape must not touch "maybe".
    expect(conditionMet({ when: "f", op: "eq", value: true }, { f: "maybe" })).toBe(false);
    expect(conditionalMet({ when: "f", op: "eq", value: true }, { f: "maybe" })).toBe(false);
  });

  it("an unanswered `when` stays fail-closed regardless of boolean-shape normalization", () => {
    expect(conditionMet({ when: "f", op: "eq", value: true }, {})).toBe(false);
    expect(conditionMet({ when: "f", op: "in", values: [true] }, {})).toBe(false);
  });
});

describe("dependencies: server↔client parity (09 §9.3 table)", () => {
  it("evaluateComponents matches server evaluateDependencies (visible/required_now)", () => {
    const nodes = [
      { type: "SingleChoiceQuestion", question_id: "q1", internal_field: "home_own", required: true, props: {} },
      {
        type: "NumberInputQuestion",
        question_id: "q2",
        internal_field: "home_value",
        props: {},
        conditional: { when: "home_own", op: "eq", value: "yes" },
      },
      {
        type: "FreeTextQuestion",
        question_id: "q3",
        internal_field: "notes",
        props: { requiredWhen: { when: "home_value", op: "gte", value: 500000 } },
      },
      {
        type: "SingleChoiceQuestion",
        question_id: "q4",
        internal_field: "renter_type",
        props: {},
        conditional: { when: "home_own", op: "neq", value: "yes" },
      },
    ];
    const answerSets: Record<string, unknown>[] = [
      {},
      { home_own: "yes" },
      { home_own: "yes", home_value: 750000 },
      { home_own: "yes", home_value: 100000, notes: "" },
      { home_own: "no" },
      { home_own: "no", renter_type: "apartment" },
      { home_own: "yes", home_value: "750000" }, // coercion edge rides through requiredWhen
    ];
    for (const answers of answerSets) {
      const server = evaluateDependencies(nodes as unknown as LeadgenComponentNode[], answers);
      const client = evaluateComponents(nodes as unknown as LgComponentConfig[], answers);
      // The client mirrors the server on the per-component axes it USES (visible
      // → reveal, required_now → validateSection). PC-A11 (P4a): the server's
      // continue_blocked/blocking_question_ids roll-up is no longer mirrored on
      // the client (it was dead — see runtime/dependencies.ts), so parity is on
      // .components only. The server still exposes it (studio preview reads it).
      expect(client.components).toEqual(server.components);
    }
  });

  it("m11 parity: an EMPTY internal_field required component agrees on visible/required_now even with a stray answers[''] key", () => {
    // The empty-internal_field node's visibility/required_now must match the
    // server on both evaluators. (The runtime's required-field GATE lives in
    // validation.ts validateSection, which SKIPS an empty internal_field — the
    // dependency roll-up that once diverged here was removed in P4a/PC-A11.)
    const nodes = [
      { type: "SingleChoiceQuestion", question_id: "q_empty", internal_field: "", required: true, props: {} },
    ];
    const answerSets: Record<string, unknown>[] = [
      { "": "stray-empty-key-answer" }, // the divergence-triggering shape
      {},
    ];
    for (const answers of answerSets) {
      const server = evaluateDependencies(nodes as unknown as LeadgenComponentNode[], answers);
      const client = evaluateComponents(nodes as unknown as LgComponentConfig[], answers);
      expect(client.components).toEqual(server.components);
      expect(client.components[0]?.required_now, "a visible required component is required_now").toBe(true);
    }
  });

  it("isAnswered matches the server emptiness semantics", () => {
    // server dependencies.ts:79–88: undefined/null/""/"  "/[]/{} unanswered;
    // 0/false/"x"/[0]/{k:1} answered.
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered("")).toBe(false);
    expect(isAnswered("   ")).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered({})).toBe(false);
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(false)).toBe(true);
    expect(isAnswered("x")).toBe(true);
    expect(isAnswered([0])).toBe(true);
    expect(isAnswered({ k: 1 })).toBe(true);
  });

  it("hiddenAnswerFields + visibleSectionIndexes derive from the same evaluator", () => {
    const sections: LgSectionConfig[] = [
      {
        section_public_id: "lgs_1",
        section_index: 0,
        headline: "H1",
        continue_mode: "auto_advance",
        address_validation_enabled: false,
        section_mapping_version: 1,
        answer_mapping_version: "v1",
        components: [component({ question_id: "q1", internal_field: "home_own" })],
      },
      {
        section_public_id: "lgs_2",
        section_index: 1,
        headline: "H2",
        continue_mode: "button",
        address_validation_enabled: false,
        section_mapping_version: 1,
        answer_mapping_version: "v1",
        components: [
          component({
            question_id: "q2",
            internal_field: "home_value",
            conditional: { when: "home_own", op: "eq", value: "yes" },
          }),
        ],
      },
    ];
    expect(hiddenAnswerFields(sections, { home_own: "no", home_value: 5 }).has("home_value")).toBe(
      true,
    );
    expect(hiddenAnswerFields(sections, { home_own: "yes" }).has("home_value")).toBe(false);
    // the fully-hidden section drops out of the traversal/progress domain
    expect(visibleSectionIndexes(sections, { home_own: "no" })).toEqual([0]);
    expect(visibleSectionIndexes(sections, { home_own: "yes" })).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// beacons: batching ≤20, envelope completeness, retry/backoff bounds
// ---------------------------------------------------------------------------

interface CapturedSend {
  url: string;
  events: Record<string, unknown>[];
}

function beaconHarness(sendImpl?: (url: string, body: string) => boolean) {
  const sent: CapturedSend[] = [];
  let clock = 1_700_000_000_000;
  const adapters: LgBeaconAdapters = {
    send: (url, body) => {
      const ok = sendImpl === undefined ? true : sendImpl(url, body);
      if (ok) sent.push({ url, events: (JSON.parse(body) as { events: Record<string, unknown>[] }).events });
      return ok;
    },
    now: () => clock,
    rand: (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) % 256;
      return bytes;
    },
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  return { sent, adapters, tick: (ms: number) => (clock += ms) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("events: beacon client", () => {
  it("batches ≤ 20 events per POST (server MAX_LEADGEN_EVENTS_PER_REQUEST)", () => {
    vi.useFakeTimers();
    const { sent, adapters } = beaconHarness();
    const client = new LgBeaconClient(adapters);
    for (let i = 0; i < 45; i++) client.enqueue("answer_click", { section_index: i });
    client.flush();
    expect(sent.map((b) => b.events.length)).toEqual([20, 20, 5]);
    expect(LG_MAX_BATCH).toBe(20);
    for (const batch of sent) {
      expect(batch.url).toBe("/lg/track");
      expect(batch.events.length).toBeLessThanOrEqual(20);
    }
  });

  it("auto-flushes when the queue reaches the cap, micro-batches below it", () => {
    vi.useFakeTimers();
    const { sent, adapters } = beaconHarness();
    const client = new LgBeaconClient(adapters);
    for (let i = 0; i < 19; i++) client.enqueue("section_view");
    expect(sent.length).toBe(0); // below cap → waiting on the micro-batch timer
    client.enqueue("section_view"); // 20th → immediate flush
    expect(sent.map((b) => b.events.length)).toEqual([20]);
    client.enqueue("quote_view");
    vi.advanceTimersByTime(800); // micro-batch window
    expect(sent.map((b) => b.events.length)).toEqual([20, 1]);
  });

  it("stamps the full §3.7 envelope + per-event fields on every beacon", () => {
    vi.useFakeTimers();
    const { sent, adapters } = beaconHarness();
    const client = new LgBeaconClient(adapters);
    client.setEnvelope({
      session_id: "sid-9",
      page_view_id: "pv-9",
      funnel_attempt_id: "att_9",
      quote_id: "lgq_9",
      funnel_id: "lgf_9",
      funnel_variant_id: "lgn_9",
      funnel_ab_test_id: "lgab_9",
      funnel_ab_test_revision: 4,
      variant_label: "B",
      assignment_bucket: "1234",
      assignment_reason: "ab_hash",
      section_order_hash: "hash9",
      url: "https://site.example/lg/quote",
      referer: "https://ref.example/",
      language: "en-US",
      utm_source: "meta",
    });
    client.enqueue("answer_click", {
      section_id: "lgs_9",
      section_index: 1,
      question_id: "q9",
      internal_field: "home_own",
      answer_value_normalized: "yes",
      answer_source: "user_selected",
      answer_mapping_version: "v3",
      section_mapping_version: 7,
      continue_mode: "auto_advance",
    });
    client.flush();
    const event = sent[0]?.events[0];
    expect(event).toBeDefined();
    const e = event as Record<string, unknown>;
    // identity envelope (ingest-accepted field names — leadgenEventFromPayload)
    expect(e["event_type"]).toBe("answer_click");
    expect(e["session_id"]).toBe("sid-9");
    expect(e["page_view_id"]).toBe("pv-9");
    expect(e["funnel_attempt_id"]).toBe("att_9");
    expect(e["quote_id"]).toBe("lgq_9");
    expect(e["funnel_id"]).toBe("lgf_9");
    expect(e["funnel_variant_id"]).toBe("lgn_9");
    expect(e["funnel_ab_test_id"]).toBe("lgab_9");
    expect(e["funnel_ab_test_revision"]).toBe(4);
    expect(e["variant_label"]).toBe("B");
    expect(e["assignment_bucket"]).toBe("1234");
    expect(e["assignment_reason"]).toBe("ab_hash");
    expect(e["section_order_hash"]).toBe("hash9");
    expect(e["url"]).toBe("https://site.example/lg/quote");
    expect(e["referer"]).toBe("https://ref.example/");
    expect(e["language"]).toBe("en-US");
    expect(e["utm_source"]).toBe("meta");
    // per-event
    expect(e["section_id"]).toBe("lgs_9");
    expect(e["answer_mapping_version"]).toBe("v3");
    expect(e["section_mapping_version"]).toBe(7);
    expect(e["answer_source"]).toBe("user_selected");
    // minted
    expect(typeof e["timestamp"]).toBe("number");
    expect(String(e["event_id"])).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });

  it("retries with bounded backoff (Σ delays ≪ 10-min KV seen-TTL) then drops", () => {
    vi.useFakeTimers();
    let calls = 0;
    const { adapters } = beaconHarness(() => {
      calls += 1;
      return false; // transport always fails
    });
    const client = new LgBeaconClient(adapters);
    client.enqueue("quote_view");
    client.flush();
    expect(calls).toBe(1); // initial attempt
    const delays = LG_DEFAULT_RETRY_DELAYS_MS;
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThan(600_000 / 2); // WELL under the TTL
    for (let i = 0; i < delays.length; i++) {
      vi.advanceTimersByTime(delays[i] ?? 0);
      expect(calls).toBe(2 + i);
    }
    // exhausted → dropped, no further timers fire anything
    vi.advanceTimersByTime(600_000);
    expect(calls).toBe(1 + delays.length);
    expect(client.droppedEvents).toBe(1);
    expect(client.pendingRetryCount()).toBe(0);
  });

  it("a retry that succeeds delivers the batch once", () => {
    vi.useFakeTimers();
    let failures = 1;
    const { sent, adapters } = beaconHarness(() => {
      if (failures > 0) {
        failures -= 1;
        return false;
      }
      return true;
    });
    const client = new LgBeaconClient(adapters);
    client.enqueue("quote_view");
    client.flush();
    expect(sent.length).toBe(0);
    vi.advanceTimersByTime(LG_DEFAULT_RETRY_DELAYS_MS[0] ?? 0);
    expect(sent.length).toBe(1);
    expect(client.sentEvents).toBe(1);
    expect(client.droppedEvents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ULID-shape event_id
// ---------------------------------------------------------------------------

describe("events: ULID-shape id", () => {
  const rand = (n: number): Uint8Array => {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 53 + 7) % 256;
    return bytes;
  };

  it("is 26 Crockford-base32 chars (no I/L/O/U)", () => {
    const id = ulidLike(Date.now(), rand);
    expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
    expect(id).not.toMatch(/[ILOU]/);
  });

  it("first 10 chars encode the timestamp monotonically", () => {
    const a = ulidLike(1_000, rand);
    const b = ulidLike(2_000, rand);
    const c = ulidLike(2_000, rand);
    expect(a.slice(0, 10) < b.slice(0, 10)).toBe(true);
    expect(b.slice(0, 10)).toBe(c.slice(0, 10)); // same ms → same time prefix
    expect(b.slice(10)).toBe(c.slice(10)); // deterministic bytes → deterministic tail
  });

  it("random tail reflects the injected bytes", () => {
    const zero = ulidLike(0, (n) => new Uint8Array(n));
    expect(zero).toBe("0".repeat(26)); // time 0 + zero bytes → all-zero symbol
  });
});

// ---------------------------------------------------------------------------
// bundle-size gate (§3.1 / §3.2 build row)
// ---------------------------------------------------------------------------

describe("bundle: committed engine-bundle.generated.ts", () => {
  it("is within the §3.1 budget and non-trivial", () => {
    expect(LEADGEN_RUNTIME_JS_BYTES).toBeLessThanOrEqual(43008);
    expect(LEADGEN_RUNTIME_JS_BYTES).toBeGreaterThan(1000);
  });

  it("BYTES matches the embedded string (ascii-only build)", () => {
    expect(LEADGEN_RUNTIME_JS.length).toBe(LEADGEN_RUNTIME_JS_BYTES);
    expect(/^[\x00-\x7F]*$/.test(LEADGEN_RUNTIME_JS)).toBe(true);
  });

  it("is the real minified engine IIFE", () => {
    expect(LEADGEN_RUNTIME_JS.startsWith('"use strict";(()=>{')).toBe(true);
    // hydration-readiness marker the anti-false-PASS suite keys on
    expect(LEADGEN_RUNTIME_JS).toContain("data-lg-ready");
    expect(LEADGEN_RUNTIME_JS).toContain("/lg/track");
    expect(LEADGEN_RUNTIME_JS).toContain("/lg/auction");
    expect(LEADGEN_RUNTIME_JS).toContain("/lg/attempt");
  });
});
