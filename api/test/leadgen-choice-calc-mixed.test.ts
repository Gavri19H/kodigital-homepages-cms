// F09 — "Send mixed types of values" (owner 2026-10-01, Slack #haikov-support):
// "Due to different values expected by different providers. In this case,
// "Fundera" wants the value sent to be the actual date, as the system allows now
// by selecting the "Send a calculated date" option, while "Amone" wants the value
// sent to be a fixed value selected from their Appendix."
// Decided 2026-11-08 (owner): the "Today minus" amount is one per choice (Q2),
// the option is per choice (Q3), and a new Value type starts as the date for an
// Offer whose payload field is a Date field (Q1, Studio side).
//
// Stored on the choice: value_calc {kind, amount, unit, mixed: true,
// date_offer_ids: [Offer ids that get the date]}. Every other Offer gets the
// literal answer through its own Provider values list (its fixed value).
//
// FAIL-BEFORE: a calculated choice sent its date to EVERY Offer (payload.ts
// skips the value list for a calculated answer), so AmOne's "6-12 Months" could
// not be sent. The live-auction proof (bytes POSTed to both Offers) is in
// leadgen-auction-runtime.test.ts ("F09 FAIL-BEFORE/PASS-AFTER").
import { describe, expect, it } from "vitest";
import {
  buildOfferPayload,
  computedForOffer,
  normalizeAnswers,
  readChoiceCalc,
  readChoiceCalcOffers,
} from "../src/leadgen/answers";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import { toPublicComponent } from "../src/public/leadgen/config-dto";

const FUNDERA = 11;
const AMONE = 22;

const content = (sixMonths: Record<string, unknown>) => ({
  components: [
    {
      type: "ButtonAnswerGroup",
      question_id: "q_dur",
      question_key: "dur",
      internal_field: "business_duration",
      answer_type: "enum",
      choices: [
        { label: "6-12 Months", value: "6", analytics_id: "6", value_calc: sixMonths },
        { label: "2+ Years", value: "2", analytics_id: "2", value_calc: { kind: "date_ago", amount: 2, unit: "years" } },
        { label: "Haven't started yet", value: "0", analytics_id: "0" },
      ],
    },
  ],
});
const MIXED = content({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [FUNDERA] });

// Fundera: a Date field (string + formatDate). AmOne: its own fixed list.
const funderaMapping = [
  {
    internal_field: "business_duration",
    offer_payload_field_path: "company.business_inception",
    provider_expected_type: "string",
    value_transform: [{ kind: "formatDate", format: "YYYY-MM-DD" }],
    required_for_offer: false,
  },
];
const amoneMapping = [
  {
    internal_field: "business_duration",
    offer_payload_field_path: "Ageofbusiness",
    provider_expected_type: "string",
    output_value_map: { "6": "6-12 Months", "2": "2+ Years", "0": "Not started" },
    required_for_offer: false,
  },
];

function sixMonthsAgo(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate()));
  if (d.getUTCDate() !== now.getUTCDate()) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

describe("F09 — one mixed choice, two Offers, each gets its own type", () => {
  it("normalizeAnswers: the literal stays the answer (analytics), the date is computed, and only Fundera is listed for it", () => {
    const n = normalizeAnswers(MIXED as never, { business_duration: "6" });
    expect(n.answers["business_duration"]).toBe("6");
    expect(n.computed["business_duration"]).toBe(sixMonthsAgo());
    expect(n.computed_offers["business_duration"]).toEqual([FUNDERA]);
  });

  it("Fundera gets the date, AmOne gets \"6-12 Months\" (before: both got the date)", () => {
    const n = normalizeAnswers(MIXED as never, { business_duration: "6" });
    const fundera = buildOfferPayload(funderaMapping as never, n.answers, computedForOffer(n.computed, n.computed_offers, FUNDERA));
    const amone = buildOfferPayload(amoneMapping as never, n.answers, computedForOffer(n.computed, n.computed_offers, AMONE));
    expect(fundera).toEqual({ company: { business_inception: sixMonthsAgo() } });
    expect(amone).toEqual({ Ageofbusiness: "6-12 Months" });
    // what every Offer got before F09: the date, for AmOne too
    expect(buildOfferPayload(amoneMapping as never, n.answers, n.computed)).toEqual({ Ageofbusiness: sixMonthsAgo() });
  });

  it("a mixed choice with no Offer on the date list sends every Offer its fixed value", () => {
    const n = normalizeAnswers(content({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [] }) as never, {
      business_duration: "6",
    });
    expect(computedForOffer(n.computed, n.computed_offers, FUNDERA)).toEqual({});
    expect(buildOfferPayload(amoneMapping as never, n.answers, computedForOffer(n.computed, n.computed_offers, AMONE))).toEqual({
      Ageofbusiness: "6-12 Months",
    });
  });

  it("unchanged: a plain calculated choice still sends the date to every Offer", () => {
    const n = normalizeAnswers(MIXED as never, { business_duration: "2" });
    expect(n.computed_offers["business_duration"]).toBeUndefined();
    const amone = buildOfferPayload(amoneMapping as never, n.answers, computedForOffer(n.computed, n.computed_offers, AMONE));
    expect(Object.keys(amone)).toEqual(["Ageofbusiness"]);
    expect(amone["Ageofbusiness"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("unchanged: a fixed choice sends each Offer its own value", () => {
    const n = normalizeAnswers(MIXED as never, { business_duration: "0" });
    expect(n.computed["business_duration"]).toBeUndefined();
    expect(buildOfferPayload(amoneMapping as never, n.answers, computedForOffer(n.computed, n.computed_offers, AMONE))).toEqual({
      Ageofbusiness: "Not started",
    });
  });

  it("an applied default on a mixed choice follows the same per-Offer rule", () => {
    const withDefault = content({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [FUNDERA] });
    (withDefault.components[0] as Record<string, unknown>)["default_value"] = "6";
    const n = normalizeAnswers(withDefault as never, {});
    if (n.answers["business_duration"] === "6") {
      expect(n.computed_offers["business_duration"]).toEqual([FUNDERA]);
    }
  });
});

describe("F09 — the stored setting is read defensively", () => {
  it("readChoiceCalc still reads the calculation of a mixed choice (amount and unit are shared, Q2)", () => {
    expect(readChoiceCalc({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [1] })).toEqual({
      kind: "date_ago",
      amount: 6,
      unit: "months",
    });
  });

  it("readChoiceCalcOffers: null for a plain calc; the list for mixed; a broken list never means everyone gets the date", () => {
    expect(readChoiceCalcOffers({ kind: "date_ago", amount: 6, unit: "months" })).toBeNull();
    expect(readChoiceCalcOffers({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [3, 4] })).toEqual([3, 4]);
    expect(readChoiceCalcOffers({ kind: "date_ago", amount: 6, unit: "months", mixed: true })).toEqual([]);
    expect(readChoiceCalcOffers({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: "3" })).toEqual([]);
    expect(readChoiceCalcOffers({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [3, "x", -1, 2.5] })).toEqual([3]);
  });
});

describe("F09 — the save gate", () => {
  const errorsFor = (calc: unknown) =>
    validateSectionContent(content(calc as Record<string, unknown>) as never).errors.filter((e) => /value_calc/.test(e.path));

  it("a mixed choice with its Offer list saves clean", () => {
    expect(errorsFor({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [FUNDERA, AMONE] })).toEqual([]);
    expect(errorsFor({ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [] })).toEqual([]);
  });

  it("a broken mixed setting is named in plain words", () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ kind: "date_ago", amount: 6, unit: "months", mixed: "yes" }, /on or off/],
      [{ kind: "date_ago", amount: 6, unit: "months", date_offer_ids: [1] }, /could not be read/],
      [{ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: ["lgo_x"] }, /could not be read/],
      [{ kind: "date_ago", amount: 6, unit: "months", mixed: true, date_offer_ids: [0] }, /could not be read/],
    ];
    for (const [calc, message] of cases) {
      const hit = errorsFor(calc)[0];
      expect(hit, JSON.stringify(calc)).toBeDefined();
      expect(hit!.message).toMatch(message);
    }
  });
});

describe("F09 — the visitor's public config never carries the Offer list", () => {
  it("date_offer_ids is dropped; the rest of the choice is kept", () => {
    const pub = toPublicComponent(MIXED.components[0] as never) as unknown as { choices: Array<Record<string, unknown>> };
    expect(pub.choices[0]?.["value_calc"]).toEqual({ kind: "date_ago", amount: 6, unit: "months", mixed: true });
    expect(JSON.stringify(pub)).not.toContain("date_offer_ids");
    expect(pub.choices[0]?.["label"]).toBe("6-12 Months");
  });

  it("a section with no mixed choice passes its choices through untouched (same array: byte-identical config)", () => {
    const plain = content({ kind: "date_ago", amount: 6, unit: "months" }).components[0] as { choices: unknown[] };
    const pub = toPublicComponent(plain as never) as unknown as { choices: unknown[] };
    expect(pub.choices).toBe(plain.choices);
  });
});
