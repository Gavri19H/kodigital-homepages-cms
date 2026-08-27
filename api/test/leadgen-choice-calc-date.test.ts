// OWNER 2026-08-27, problem 2 of 2: "I can't convert the user answer to a date by
// logical calculation - for example, I want that if the user clicks the button
// '2+ Years', the value that will be sent is 'Today - 2 years in format
// DD/MM/YYYY' (and if the field itself has another format the field format is the
// winner). It means we need to add an option to 'calculated data' in the 'saved
// value' field."
//
// OWNER RULING when asked what the answers with no sensible calculation should
// send: "the user that creates this section have the freedome to choose what to
// send. It isn't something you need to solve hardcoded." So the switch is PER
// CHOICE — "Haven't started yet" stays a fixed value while "2+ Years"
// calculates, and that is the operator's call, never a rule in here.
//
// FAIL-BEFORE: there was no calculation anywhere. A choice could only carry a
// literal, so a date field bound to this question received "2".
import { describe, expect, it } from "vitest";
import {
  LEADGEN_CHOICE_CALC_MAX_AMOUNT,
  LEADGEN_CHOICE_CALC_UNITS,
  buildOfferPayload,
  evaluateChoiceCalc,
  normalizeAnswers,
  readChoiceCalc,
} from "../src/leadgen/answers";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";

// His question, with his own saved values, and his own mixed intent.
const CONTENT = {
  components: [
    {
      type: "ButtonAnswerGroup",
      question_id: "q_dur",
      question_key: "dur",
      internal_field: "business_duration",
      answer_type: "enum",
      choices: [
        { label: "2+ Years", value: "2", analytics_id: "2", value_calc: { kind: "date_ago", amount: 2, unit: "years" } },
        { label: "1-2 Years", value: "1", analytics_id: "1", value_calc: { kind: "date_ago", amount: 1, unit: "years" } },
        { label: "6-12 Months", value: "0.5", analytics_id: "0.5", value_calc: { kind: "date_ago", amount: 6, unit: "months" } },
        // left FIXED on purpose — the owner's ruling
        { label: "Haven't started yet", value: "none", analytics_id: "none" },
      ],
    },
  ],
};

// His real payload field, read out of production D1: string storage carrying one
// formatDate step, which IS what the builder's Type = Date stores.
const dateFieldMapping = (format: string) => [
  {
    internal_field: "business_duration",
    offer_payload_field_path: "company.business_inception",
    provider_expected_type: "string",
    value_transform: [{ kind: "formatDate", format }],
    required_for_offer: false,
  },
];

const sent = (picked: string, format: string): unknown => {
  const n = normalizeAnswers(CONTENT as never, { business_duration: picked });
  const payload = buildOfferPayload(dateFieldMapping(format) as never, n.answers, n.computed);
  return (payload["company"] as Record<string, unknown> | undefined)?.["business_inception"];
};

describe("a calculated saved value sends a DATE (owner 2026-08-27)", () => {
  it("his example, exactly: tapping 2+ Years sends today minus 2 years", () => {
    const iso = sent("2", "YYYY-MM-DD") as string;
    expect(typeof iso).toBe("string");
    const expected = new Date(Date.now());
    expected.setUTCFullYear(expected.getUTCFullYear() - 2);
    expect(iso).toBe(expected.toISOString().slice(0, 10));
  });

  it("THE FIELD'S OWN FORMAT WINS — his parenthetical, with no precedence rule to write", () => {
    // The calc emits the canonical ISO date; the field's formatDate then runs on
    // it. That ordering IS the rule, which is why nothing here has to enforce it.
    const iso = sent("2", "YYYY-MM-DD") as string;
    const ddmm = sent("2", "DD/MM/YYYY") as string;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ddmm).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    // same day, two formats — the field decided
    const [y, m, d] = iso.split("-");
    expect(ddmm).toBe(`${d}/${m}/${y}`);
  });

  it("every calculated choice sends ITS OWN date; months and years both work", () => {
    const twoY = sent("2", "YYYY-MM-DD") as string;
    const oneY = sent("1", "YYYY-MM-DD") as string;
    const sixM = sent("0.5", "YYYY-MM-DD") as string;
    // strictly ordered: 2 years ago < 1 year ago < 6 months ago
    expect(twoY < oneY).toBe(true);
    expect(oneY < sixM).toBe(true);
    // and 6 months really is ~6 months, not 6 of something else
    const monthsBack = (Date.now() - Date.parse(sixM + "T00:00:00Z")) / (1000 * 60 * 60 * 24 * 30.44);
    expect(monthsBack).toBeGreaterThan(5.5);
    expect(monthsBack).toBeLessThan(6.6);
  });

  it("a choice the operator left FIXED is untouched — the owner's ruling, not a hardcoded rule", () => {
    // "none" is not a date, so the date field takes its fallback (absent) —
    // exactly the delete-key behaviour a literal has always had here.
    expect(sent("none", "YYYY-MM-DD")).toBeUndefined();
    // …and the answer itself is still the literal, so nothing about the fixed
    // choice changed.
    const n = normalizeAnswers(CONTENT as never, { business_duration: "none" });
    expect(n.answers["business_duration"]).toBe("none");
    expect(n.computed["business_duration"]).toBeUndefined();
  });

  it("ANALYTICS keeps the literal — one row per answer, not one row per day", () => {
    // The calc rides a SEPARATE map. If it had replaced the answer, the
    // distribution table would scatter every "2+ Years" click across a new value
    // each day and the grouping would be destroyed.
    for (const picked of ["2", "1", "0.5", "none"]) {
      const n = normalizeAnswers(CONTENT as never, { business_duration: picked });
      expect(n.answers["business_duration"], `${picked} stays itself in answers`).toBe(picked);
    }
    const two = normalizeAnswers(CONTENT as never, { business_duration: "2" });
    expect(two.computed["business_duration"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // FOUND WHILE TESTING, and worth naming loudly: without a calc, his literals
  // do NOT come out absent — they come out as GARBAGE DATES. formatDate feeds
  // the value to `new Date(...)`, and JS parses bare "2" as 2001-01-31, "1" as
  // 2000-12-31, "0.5" as 2000-04-30. So the pre-change behaviour on his own
  // funnel was not "the date field is empty", it was "the buyer receives a
  // confident, wrong date". This test PINS that trap so the calculated path
  // cannot quietly regress into it, and so the next person reading this knows
  // why a calc is the fix rather than a nicety.
  it("WITHOUT a calc his literals become garbage dates — the trap this feature closes", () => {
    const plain = {
      components: [
        {
          ...CONTENT.components[0],
          choices: (CONTENT.components[0] as { choices: Array<Record<string, unknown>> }).choices.map((c) => {
            const { value_calc, ...rest } = c;
            void value_calc;
            return rest;
          }),
        },
      ],
    };
    const send = (picked: string): unknown => {
      const n = normalizeAnswers(plain as never, { business_duration: picked });
      expect(n.computed, "no calc authored ⇒ nothing computed").toEqual({});
      const payload = buildOfferPayload(dateFieldMapping("YYYY-MM-DD") as never, n.answers, n.computed);
      return (payload["company"] as Record<string, unknown> | undefined)?.["business_inception"];
    };
    // a date around the millennium, from an answer that means "2 years"
    const two = send("2") as string;
    expect(two).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(two.slice(0, 4))).toBeLessThan(2010);
    // …and with the calc authored, the SAME tap sends a correct recent date
    const withCalc = sent("2", "YYYY-MM-DD") as string;
    expect(Number(withCalc.slice(0, 4))).toBeGreaterThan(2020);
    // only a value JS cannot parse at all was ever dropped
    expect(send("none")).toBeUndefined();
  });

  it("a question with NO calc on any choice leaves the computed map empty", () => {
    const plain = {
      components: [
        {
          ...CONTENT.components[0],
          choices: (CONTENT.components[0] as { choices: Array<Record<string, unknown>> }).choices.map((c) => {
            const { value_calc, ...rest } = c;
            void value_calc;
            return rest;
          }),
        },
      ],
    };
    const n = normalizeAnswers(plain as never, { business_duration: "2" });
    expect(n.computed).toEqual({});
    expect(n.answers["business_duration"]).toBe("2");
  });

  it("an APPLIED DEFAULT calculates too — a default IS the visitor's answer", () => {
    const withDefault = {
      components: [
        { ...CONTENT.components[0], props: { defaultValue: "2" } },
      ],
    };
    // nothing submitted: the default applies, and it must calculate like a tap
    const n = normalizeAnswers(withDefault as never, {});
    expect(n.answers["business_duration"]).toBe("2");
    expect(n.computed["business_duration"], "a default-selected choice calculates").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the calc vocabulary is CLOSED — no expression evaluator on the money path", () => {
  it("evaluates the three units against a fixed instant, UTC", () => {
    const now = Date.UTC(2026, 7, 27); // 2026-08-27
    const at = (amount: number, unit: string) =>
      evaluateChoiceCalc(readChoiceCalc({ kind: "date_ago", amount, unit })!, now);
    expect(at(2, "years")).toBe("2024-08-27");
    expect(at(0, "years")).toBe("2026-08-27"); // 0 = today
    expect(at(6, "months")).toBe("2026-02-27");
    expect(at(30, "days")).toBe("2026-07-28");
  });

  it("a month/year shift onto a shorter month clamps INSIDE the intended month", () => {
    // 31 Mar minus 1 month rolls forward to 2 Mar in naive JS date maths; the
    // answer must never land in the month AFTER the one the operator meant.
    const mar31 = Date.UTC(2026, 2, 31);
    expect(evaluateChoiceCalc(readChoiceCalc({ kind: "date_ago", amount: 1, unit: "months" })!, mar31)).toBe("2026-02-28");
    // 29 Feb on a leap year minus 1 year has no 29 Feb to land on
    const feb29 = Date.UTC(2024, 1, 29);
    expect(evaluateChoiceCalc(readChoiceCalc({ kind: "date_ago", amount: 1, unit: "years" })!, feb29)).toBe("2023-02-28");
  });

  it("refuses everything that is not one of the three units and a whole amount", () => {
    for (const bad of [
      "2y",
      42,
      null,
      [],
      { kind: "eval", amount: 2, unit: "years" },
      { kind: "date_ago", amount: 2.5, unit: "years" },
      { kind: "date_ago", amount: -1, unit: "years" },
      { kind: "date_ago", amount: LEADGEN_CHOICE_CALC_MAX_AMOUNT + 1, unit: "years" },
      { kind: "date_ago", amount: 2, unit: "fortnights" },
      { kind: "date_ago", amount: "2", unit: "years" },
    ]) {
      expect(readChoiceCalc(bad), `${JSON.stringify(bad)} must be refused`).toBeNull();
    }
    // the accepted set is exactly the declared units
    for (const unit of LEADGEN_CHOICE_CALC_UNITS) {
      expect(readChoiceCalc({ kind: "date_ago", amount: 3, unit })).not.toBeNull();
    }
  });

  it("a malformed calc that somehow reached storage sends the LITERAL, never a crash", () => {
    const corrupt = {
      components: [
        {
          ...CONTENT.components[0],
          choices: [{ label: "2+ Years", value: "2", analytics_id: "2", value_calc: { kind: "shell", cmd: "rm -rf" } }],
        },
      ],
    };
    const n = normalizeAnswers(corrupt as never, { business_duration: "2" });
    expect(n.answers["business_duration"]).toBe("2");
    expect(n.computed["business_duration"]).toBeUndefined();
  });
});

describe("the save gate reports a bad calc to the operator", () => {
  const contentWith = (calc: unknown) => ({
    components: [
      {
        type: "ButtonAnswerGroup",
        question_id: "q_dur",
        question_key: "dur",
        internal_field: "business_duration",
        answer_type: "enum",
        choices: [{ label: "2+ Years", value: "2", analytics_id: "2", value_calc: calc }],
      },
    ],
  });

  it("a valid calc saves clean", () => {
    const res = validateSectionContent(contentWith({ kind: "date_ago", amount: 2, unit: "years" }) as never);
    expect(res.errors.filter((e) => /value_calc/.test(e.path))).toEqual([]);
  });

  it("each malformed part is named, in plain words, at its own path", () => {
    const cases: Array<[unknown, RegExp]> = [
      ["today-2y", /group of settings/],
      [{ kind: "eval", amount: 2, unit: "years" }, /only calculation available/],
      [{ kind: "date_ago", amount: 2.5, unit: "years" }, /whole number/],
      [{ kind: "date_ago", amount: -3, unit: "years" }, /whole number/],
      [{ kind: "date_ago", amount: 2, unit: "fortnights" }, /must be one of/],
    ];
    for (const [calc, message] of cases) {
      const res = validateSectionContent(contentWith(calc) as never);
      const hit = res.errors.find((e) => /value_calc/.test(e.path));
      expect(hit, `${JSON.stringify(calc)} must be reported`).toBeDefined();
      expect(hit!.message).toMatch(message);
      // never a storage key or a stack trace at a person
      expect(hit!.message).not.toContain("undefined");
    }
  });
});
