// P5 (register PC-10, operator decision D2 — Image9 "a good explanation for
// multi-choice including default answers") — the MultiQuestionGrid component.
//
// ONE node renders several labeled sub-question ROWS, each a shared (or per-row-
// overridden) pill pair with an optional pre-selected DEFAULT. Each ROW is its
// OWN answer field (produces "object", like NameFieldsGroup/Address). The
// zero-runtime-byte bridge: config-dto's expandPublicComponents projects each
// row into a synthetic single-field choice component, so the EXISTING runtime
// machinery (applySectionDefaults / enterSection paint / handleChoiceActivation
// / validateSection) seeds + paints + records + validates every row with NO new
// engine logic; presets stamps the SAME per-row question_id on each row's
// [data-lg-question] wrapper (multiQuestionRowQuestionId), so #lg-config and the
// DOM agree by construction; answers.ts fieldsOf expands the rows so normalize /
// payload / auction all see them as ordinary fields.
//
// This suite pins the DETERMINISTIC contract: schema validation, render
// structure, the config-dto row projection, default seeding + recording, per-row
// required, and the normalize→payload auction round-trip (the R1 pattern, pure
// pipeline — the full signed-HTTP /lg/auction leg + the live browser flow ride
// the Playwright spec).

import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  readMultiQuestionRows,
  multiQuestionRowChoices,
  multiQuestionRowQuestionId,
  MULTI_QUESTION_MAX_ROWS,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import { expandPublicComponents } from "../src/public/leadgen/config-dto";
import { normalizeAnswers, generateOfferPayload } from "../src/leadgen/answers";
import type { LeadgenAnswerMapping } from "../src/leadgen/answers";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

// The reference (Image9) pill pair — a SHARED Yes/No set every row reuses.
const YESNO = [
  { label: "Yes", value: "yes", analytics_id: "yes" },
  { label: "No", value: "no", analytics_id: "no" },
];

// A faithful "Tell us about the driver" grid: four labeled sub-questions, each a
// default-selected Yes/No pill pair (Gender overrides with its own pill set).
function driverGrid(overrides: Partial<LeadgenComponentNode> = {}): LeadgenComponentNode {
  return {
    type: "MultiQuestionGrid",
    question_id: "q_driver",
    choices: YESNO,
    props: {
      rows: [
        { label: "Homeowner", internal_field: "homeowner", default: "yes", required: true },
        { label: "Married", internal_field: "married", default: "no" },
        {
          label: "Gender",
          internal_field: "gender",
          default: "male",
          choices: [
            { label: "Male", value: "male", analytics_id: "male" },
            { label: "Female", value: "female", analytics_id: "female" },
          ],
        },
        { label: "Military Affiliation", internal_field: "military", default: "no" },
      ],
    },
    ...overrides,
  };
}

function content(...components: LeadgenComponentNode[]): LeadgenSectionContent {
  return { components };
}

// ---------------------------------------------------------------------------
// 1. Schema validation
// ---------------------------------------------------------------------------

describe("P5 MultiQuestionGrid — schema validation", () => {
  it("accepts the reference 4-row driver grid (shared + per-row pills, valid defaults)", () => {
    expect(validateSectionContent(content(driverGrid())).errors).toEqual([]);
  });

  it("rejects an empty rows array (invalid_field_prop)", () => {
    const r = validateSectionContent(content(driverGrid({ props: { rows: [] } })));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.path.endsWith(".props.rows"))).toBe(true);
  });

  it("rejects more than 8 rows", () => {
    const rows = Array.from({ length: MULTI_QUESTION_MAX_ROWS + 1 }, (_, i) => ({
      label: `Q${i}`,
      internal_field: `f${i}`,
    }));
    const r = validateSectionContent(content(driverGrid({ props: { rows } })));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.message.includes("at most"))).toBe(true);
  });

  it("accepts exactly 8 rows (the boundary)", () => {
    const rows = Array.from({ length: MULTI_QUESTION_MAX_ROWS }, (_, i) => ({
      label: `Q${i}`,
      internal_field: `f${i}`,
    }));
    expect(validateSectionContent(content(driverGrid({ props: { rows } }))).errors).toEqual([]);
  });

  it("rejects a shared pill set outside 2-4 (invalid_choice)", () => {
    const one = [{ label: "Only", value: "only", analytics_id: "only" }];
    const r = validateSectionContent(
      content(
        driverGrid({
          choices: one,
          props: { rows: [{ label: "R", internal_field: "r", default: "only" }] },
        }),
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "invalid_choice" && e.path.endsWith(".choices"))).toBe(true);
  });

  it("rejects a row whose default is not among its effective choices", () => {
    const r = validateSectionContent(
      content(driverGrid({ props: { rows: [{ label: "R", internal_field: "r", default: "maybe" }] } })),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "invalid_choice" && e.path.endsWith(".default"))).toBe(true);
  });

  it("honors a per-row default drawn from that row's OWN pill override (not the shared set)", () => {
    // gender default "male" is NOT in the shared Yes/No set — it is valid ONLY
    // because the row overrides `choices` with Male/Female.
    expect(validateSectionContent(content(driverGrid())).errors).toEqual([]);
    // but the same default against the shared set (no override) is rejected
    const r = validateSectionContent(
      content(driverGrid({ props: { rows: [{ label: "Gender", internal_field: "gender", default: "male" }] } })),
    );
    expect(r.errors.some((e) => e.code === "invalid_choice" && e.path.endsWith(".default"))).toBe(true);
  });

  it("rejects a per-row choices override outside 2-4", () => {
    const r = validateSectionContent(
      content(
        driverGrid({
          props: {
            rows: [
              {
                label: "R",
                internal_field: "r",
                choices: [{ label: "A", value: "a", analytics_id: "a" }],
              },
            ],
          },
        }),
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "invalid_choice" && e.path.includes("rows[0].choices"))).toBe(true);
  });

  it("rejects a row missing its label or internal_field", () => {
    const r = validateSectionContent(
      content(driverGrid({ props: { rows: [{ internal_field: "r" }, { label: "L" }] } })),
    );
    expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.path.endsWith("rows[0].label"))).toBe(true);
    expect(
      r.errors.some((e) => e.code === "invalid_field_prop" && e.path.endsWith("rows[1].internal_field")),
    ).toBe(true);
  });

  it("a row internal_field JOINS the Section-wide uniqueness universe — collision with a sibling field is duplicate_internal_field", () => {
    const sibling: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q_note",
      internal_field: "homeowner", // collides with the grid's first row
    };
    const r = validateSectionContent(content(driverGrid(), sibling));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "duplicate_internal_field")).toBe(true);
  });

  it("rejects two rows sharing an internal_field", () => {
    const r = validateSectionContent(
      content(
        driverGrid({
          props: {
            rows: [
              { label: "A", internal_field: "dup", default: "yes" },
              { label: "B", internal_field: "dup", default: "no" },
            ],
          },
        }),
      ),
    );
    expect(r.errors.some((e) => e.code === "duplicate_internal_field")).toBe(true);
  });

  it("registers row fields as known so a sibling's conditional may reference a row by field (no conditional_unknown_field)", () => {
    const dependent: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q_dep",
      internal_field: "dep_note",
      conditional: { when: "homeowner", op: "eq", value: "yes" },
    };
    const r = validateSectionContent(content(driverGrid(), dependent));
    expect(r.errors.some((e) => e.code === "conditional_unknown_field")).toBe(false);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Render structure (each row = a standard single-field choice question)
// ---------------------------------------------------------------------------

describe("P5 MultiQuestionGrid — render structure", () => {
  const html = renderComponent(driverGrid(), DESIGN);

  it("wraps the grid in .lg-mqg carrying the node identity but NO node-level [data-lg-question]", () => {
    expect(html).toContain('class="lg-mqg"');
    expect(html).toContain('data-component-type="MultiQuestionGrid"');
    expect(html).not.toContain('data-lg-question="q_driver"');
  });

  it("renders one [data-lg-question]/[data-lg-field] row per sub-question, at the shared row question_id", () => {
    for (const row of readMultiQuestionRows(driverGrid())) {
      const rowQid = multiQuestionRowQuestionId("q_driver", row.internal_field);
      expect(html, `row ${row.internal_field} question hook`).toContain(`data-lg-question="${rowQid}"`);
      expect(html, `row ${row.internal_field} field hook`).toContain(`data-lg-field="${row.internal_field}"`);
    }
  });

  it("pre-selects each row's DEFAULT pill server-side (.lg-selected + aria-checked=true); non-defaults stay unchecked", () => {
    // Homeowner default "yes" → the Yes pill is selected, the No pill is not.
    expect(html).toMatch(
      /class="lg-btn lg-btn-answer lg-selected" role="radio" aria-checked="true" [^>]*data-lg-choice="yes"/,
    );
    expect(html).toMatch(/class="lg-btn lg-btn-answer" role="radio" aria-checked="false" [^>]*data-lg-choice="no"/);
  });

  it("each pill carries data-lg-choice (the recording hook the runtime reads)", () => {
    expect(html).toContain('data-lg-choice="yes"');
    expect(html).toContain('data-lg-choice="male"'); // the per-row Gender override
  });

  it("renders a hidden per-row error slot bound to the row's internal_field", () => {
    for (const row of readMultiQuestionRows(driverGrid())) {
      expect(html, `row ${row.internal_field} slot`).toMatch(
        new RegExp(`<p class="lg-error lg-error-auto"[^>]*hidden[^>]*data-lg-error-for="${row.internal_field}"[^>]*></p>`),
      );
    }
  });

  it("labels each pill group via aria-labelledby → the row label (a11y radiogroup)", () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(">Homeowner</span>");
    expect(html).toContain('aria-labelledby="mqg-homeowner-label"');
  });

  it("emits no <style>/<script> and escapes hostile row labels", () => {
    const hostile = renderComponent(
      driverGrid({ props: { rows: [{ label: "<script>x</script>", internal_field: "h", default: "yes" }] } }),
      DESIGN,
    );
    expect(hostile.includes("<script>x")).toBe(false);
    expect(hostile.includes("<style")).toBe(false);
  });

  it("the whole section render places one [data-lg-question] per row (the §11.6 probe counts sub-questions)", () => {
    const sectionHtml = renderSectionComponents([driverGrid()], DESIGN, {
      headline_text: "Tell us about the driver",
      subheadline_text: null,
    });
    const count = (sectionHtml.match(/data-lg-question=/g) ?? []).length;
    expect(count).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. config-dto row expansion — the zero-runtime-byte bridge
// ---------------------------------------------------------------------------

describe("P5 MultiQuestionGrid — config-dto row projection", () => {
  it("expands ONE grid node into ONE synthetic single-field choice component PER ROW", () => {
    const projected = expandPublicComponents(driverGrid());
    expect(projected).toHaveLength(4);
    const fields = projected.map((c) => c.internal_field);
    expect(fields).toEqual(["homeowner", "married", "gender", "military"]);
  });

  it("each synthetic component's question_id equals the presets row question_id (config ≡ DOM)", () => {
    for (const c of expandPublicComponents(driverGrid())) {
      expect(c.question_id).toBe(multiQuestionRowQuestionId("q_driver", c.internal_field!));
    }
  });

  it("carries the row's effective pill set as choices + the row default as default_answer (the TwoButtonYesNo seed path)", () => {
    const byField = Object.fromEntries(expandPublicComponents(driverGrid()).map((c) => [c.internal_field, c]));
    // Homeowner reuses the shared Yes/No set; its default seeds default_applied.
    expect(byField["homeowner"]!.choices).toEqual(YESNO);
    expect(byField["homeowner"]!.default_answer).toEqual({ value: "yes", answer_source: "default_applied" });
    // Gender uses its OWN pill override.
    expect(byField["gender"]!.choices).toEqual(multiQuestionRowChoices(driverGrid(), readMultiQuestionRows(driverGrid())[2]!));
    expect(byField["gender"]!.default_answer).toEqual({ value: "male", answer_source: "default_applied" });
  });

  it("carries required + client_validation.required only for a required row (Homeowner), never for the rest", () => {
    const byField = Object.fromEntries(expandPublicComponents(driverGrid()).map((c) => [c.internal_field, c]));
    expect(byField["homeowner"]!.required).toBe(true);
    expect(byField["homeowner"]!.client_validation).toEqual({ required: true });
    expect(byField["married"]!.required).toBeUndefined();
    expect(byField["married"]!.client_validation).toBeUndefined();
  });

  it("copies a whole-grid conditional onto every row so they show/hide together", () => {
    const cond = { when: "some_field", op: "eq" as const, value: "x" };
    const withField: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q_src",
      internal_field: "some_field",
    };
    // (validity of the conditional target is a section-level concern; here we
    // only assert the projection copies it verbatim to each row.)
    void withField;
    const projected = expandPublicComponents(driverGrid({ conditional: cond }));
    for (const c of projected) expect(c.conditional).toEqual(cond);
  });

  it("a non-grid node still projects 1:1 (byte-identical to the pre-P5 map)", () => {
    const plain: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q_note",
      internal_field: "note",
      props: {},
    };
    const projected = expandPublicComponents(plain);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.internal_field).toBe("note");
  });
});

// ---------------------------------------------------------------------------
// 4. Defaults recording + 5. Required + 6. Auction round-trip (pure pipeline)
// ---------------------------------------------------------------------------

describe("P5 MultiQuestionGrid — defaults record + the normalize→payload round-trip", () => {
  it("seeds every defaulted row as default_applied even with ZERO user answers (defaults satisfy required with no clicks)", () => {
    const { answers, sources } = normalizeAnswers(content(driverGrid()), {});
    expect(answers).toEqual({ homeowner: "yes", married: "no", gender: "male", military: "no" });
    expect(sources["homeowner"]).toBe("default_applied");
    expect(sources["gender"]).toBe("default_applied");
  });

  it("a user answer on a row overrides that row's default (user_selected), leaving the others defaulted", () => {
    const { answers, sources } = normalizeAnswers(content(driverGrid()), {
      homeowner: { value: "no", touched: true },
    });
    expect(answers["homeowner"]).toBe("no");
    expect(sources["homeowner"]).toBe("user_selected");
    expect(answers["married"]).toBe("no");
    expect(sources["married"]).toBe("default_applied");
  });

  it("a touched value equal to the default records user_confirmed_default", () => {
    const { sources } = normalizeAnswers(content(driverGrid()), { homeowner: { value: "yes", touched: true } });
    expect(sources["homeowner"]).toBe("user_confirmed_default");
  });

  it("an un-defaulted, un-answered row contributes NOTHING (never a fabricated empty)", () => {
    const grid = driverGrid({
      props: { rows: [{ label: "Optional", internal_field: "opt" }] },
    });
    const { answers } = normalizeAnswers(content(grid), {});
    expect("opt" in answers).toBe(false);
  });

  it("AUCTION ROUND-TRIP (R1 pattern): a per-row answer flows normalize→payload and arrives in the Offer payload", () => {
    // A mapping keyed on the grid's `homeowner` row field → the provider field.
    const mappings: LeadgenAnswerMapping[] = [
      {
        internal_field: "homeowner",
        offer_payload_field_path: "applicant.owns_home",
        provider_expected_type: "string",
        output_value_map: { yes: "Y", no: "N" },
      },
      {
        internal_field: "gender",
        offer_payload_field_path: "applicant.gender",
        provider_expected_type: "string",
      },
    ];
    // Visitor changes Homeowner to "no", leaves the rest at their defaults.
    const { answers, payload } = generateOfferPayload(
      content(driverGrid()),
      { homeowner: { value: "no", touched: true } },
      mappings,
    );
    // The normalized answer space carries every row (the auction rule context).
    expect(answers).toMatchObject({ homeowner: "no", married: "no", gender: "male", military: "no" });
    // The row answers arrive in the provider payload (value_map applied).
    expect(payload).toEqual({ applicant: { owns_home: "N", gender: "male" } });
  });

  it("a defaulted row rides the payload even when the client posts NOTHING (server re-seeds via fieldsOf)", () => {
    const mappings: LeadgenAnswerMapping[] = [
      { internal_field: "homeowner", offer_payload_field_path: "owns_home", provider_expected_type: "string" },
    ];
    const { payload } = generateOfferPayload(content(driverGrid()), {}, mappings);
    expect(payload).toEqual({ owns_home: "yes" });
  });
});
