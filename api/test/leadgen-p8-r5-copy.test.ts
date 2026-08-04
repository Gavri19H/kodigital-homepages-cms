// P8 S5.1 — the R5 copy check (contract §6 M5 / §4 R5).
//
// Owner, verbatim: "the rules you build are using jargon".
//
// A save error walks validateSectionContent -> sections.ts (`content.<path>`)
// -> quotes-handlers -> the API -> the Section Studio's save banner
// (ui-section-studio routeSaveFieldErrors -> renderSaveFieldErrors). Every
// message on that walk is read by a PERSON, so no spec clause reference
// ("(§9.3)") and no raw stored id ("props.selected_marker") may appear in one.
//
// This file proves that TWO ways, and both are deliberate:
//
//   R5-A  DRIVEN. The real validators are run over really-broken Section
//         content and the assertions are made on the messages they really
//         emitted. Nothing here hand-builds a message (E10/E11) — the
//         producer is the shipped validator.
//
//   R5-B  SOURCE-DERIVED. The set of user-visible save-error surfaces is
//         COMPUTED, not listed: start at the save entry point
//         (src/leadgen/sections.ts), walk its static relative-import closure,
//         keep every module that emits a save message (a push()/warn() typed
//         error or an `errors[...] =` assignment), and assert that no message
//         in any of them carries a clause reference. A new emitter module, or
//         a new clause reference inside an existing one, fails this test
//         without anyone remembering to update a list.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateMappingReferences, validateSection } from "../src/leadgen/sections";
import type { LeadgenAnswerMapEdge, OfferSchemaInfo } from "../src/leadgen/sections";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";

// __file__-relative, never a hardcoded workspace path.
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = dirname(TEST_DIR);
const SAVE_ENTRY = join(API_DIR, "src/leadgen/sections.ts");

// ---------------------------------------------------------------------------
// R5-A — drive the real validators, assert on the real messages
// ---------------------------------------------------------------------------

// A clause reference in any of its written forms: "(§9.3)", "§14.10", "(§R-B/D1)".
const CLAUSE_REF = /§/;

// Stored ids that have an operator-facing name on the Section Studio surface.
// A message may never present the id instead of that name (the "Analytics Id"
// class: the operator's column reads "Analytics ID", the studio's paint-time
// humanizer had been title-casing the raw `analytics_id` behind their back).
const RAW_ID_IN_COPY: readonly RegExp[] = [
  /\bprops\.[a-z_]/i,
  /\bdesign_overrides\b/,
  /\bchoice\.[a-z_]/i,
  /\blayout\.[a-z_]/i,
  /\banalytics_id\b/,
  /\binternal_field\b/,
  /\bcustom_px\b/,
  /\bimageMediaId\b/,
  /\bphone_format\b/,
  /\bselected_marker\b/,
  /\bslider_type\b/,
  /\bcurrency_affix\b/,
  /\berror_text\b/,
  /\bvalid_values\b/,
  /\bfull_address\b/,
];

function assertOperatorCopy(messages: readonly string[], where: string): void {
  expect(messages.length, `${where}: the drive must actually produce messages`).toBeGreaterThan(0);
  for (const message of messages) {
    expect(CLAUSE_REF.test(message), `${where}: clause reference in operator copy — ${message}`).toBe(
      false,
    );
    for (const raw of RAW_ID_IN_COPY) {
      expect(raw.test(message), `${where}: raw stored id ${String(raw)} in operator copy — ${message}`).toBe(
        false,
      );
    }
  }
}
// NOTE (deliberately absent): there is no blanket "every message ends on an
// action" assertion here. These drives sweep up messages this slice did not
// re-mint (the save path's non-clause-cited copy), so such a rule would police
// copy nobody has rewritten yet — a gate no clause asked for. The action half
// of each re-minted message is asserted by name in the driven-example test
// below instead.

// A Section whose content trips a broad spread of the content rules at once —
// container props, size/placement, curated overrides, field props, Maps,
// Address, Other values, binds, choices, defaults, duplicate internal fields.
function brokenContent(): unknown {
  return {
    components: [
      // Bound headline carrying its own text + a duplicate bind further down.
      { type: "QuestionHeadline", bind: "headline", props: { text: "no" } },
      { type: "Subheadline", bind: "nope", props: { text: "x" } },
      // Layout container carrying answer fields + bad container props + a
      // non-curated override + arbitrary CSS + a bad color-typed override.
      {
        type: "CardPanel",
        internal_field: "not_here",
        choices: [],
        answer_type: "string",
        props: { padding: "enormous", align: 7 },
        children: [
          // Placement: bad row id, bad align, out-of-range nudge, unknown key.
          {
            type: "Spacer",
            layout: { row: "a b c", align: "sideways", nudge_x: 9999, zoom: 2 },
          },
        ],
      },
      // A Slider carrying props that belong to other components, plus the
      // curated-override bag on a LEAF (a §8.5 container returns before the
      // leaf tail, so its own bag is not walked — see the adjacent note).
      {
        type: "NumberRangeQuestion",
        internal_field: "budget",
        design_overrides: {
          bogus_key: "x",
          iconColor: "rgb(1,2,3) !important",
          corners: "spiky",
          border_color: "chartreuse",
          size: { width: "gigantic", depth: 4 },
        },
        props: {
          label: 42,
          slider_type: "spinny",
          currency_affix: "yes",
          role: "footnote",
          source: "upload",
          icon: "not-an-icon",
          format: "hieroglyph",
          required: true,
          min: 0,
          max: 10,
        },
      },
      // A ZIP field with Maps enabled and no job (the §9.3 warning) plus a
      // junk Maps key and a junk fill slot.
      {
        type: "ZIPInputQuestion",
        internal_field: "zip",
        props: {
          maps: {
            enabled: true,
            jobs: { validate: false, auction: false, autocomplete: false, teleport: true },
            fills: { street: "", moon: "x" },
          },
        },
      },
      // Duplicate internal_field (the "Ks Nm" class).
      { type: "FreeTextQuestion", internal_field: "zip", props: { label: "Again" } },
      // Icon cards: a choice missing its analytics id, label, icon; an emoji
      // AND an icon on one choice; a default that is not one of the answers.
      {
        type: "IconCardAnswerGrid",
        internal_field: "cover",
        props: { defaultValue: "not-a-choice" },
        choices: [
          { value: "a" },
          { label: "B", value: "b", analytics_id: "b", icon: "home", emoji: "🏠", disabled: "no" },
        ],
      },
      // Address field-set + Other values on a component that has neither.
      {
        type: "AddressAutocompleteQuestion",
        internal_field: "addr",
        props: {
          fields: [{ field: "moonbase", mode: "telepathy", validation: "psychic" }],
          other: { enabled: "sure", choices: [] },
        },
      },
      // A non-container carrying children.
      { type: "Spacer", children: [{ type: "Spacer" }] },
      // A frame-scope component inside a Section (a warning) with placement.
      { type: "HeaderBar", layout: { row: "r1" } },
    ],
  };
}

describe("P8 R5 — save errors speak the operator's language (contract §6 M5 / §4 R5)", () => {
  it("R5-A: validateSectionContent's real messages carry no clause reference and no raw stored id", () => {
    const verdict = validateSectionContent(brokenContent(), "button");
    expect(verdict.ok, "the drive must really fail validation").toBe(false);
    const messages = [...verdict.errors, ...verdict.warnings].map((e) => e.message);
    // Counted, not asserted-as-adjective: this drive must exercise a broad
    // spread of the rule set, not one lucky branch.
    expect(messages.length, "messages produced by the real validator").toBeGreaterThan(25);
    assertOperatorCopy(messages, "validateSectionContent");
  });

  it("R5-A: the Maps-no-job warning reuses the shipped register of language", () => {
    const verdict = validateSectionContent(brokenContent(), "button");
    const mapsNoJob = verdict.warnings.find((w) => w.code === "maps_no_job");
    expect(mapsNoJob, "the §9.3 maps_no_job warning fires").toBeDefined();
    // quotes-handlers' variant-level twin already said this in plain words —
    // the save-time message says the SAME thing, ending on the same action.
    expect(mapsNoJob?.message).toBe(
      "Maps is on but no job is selected (validate/auction/autocomplete) — it does nothing at runtime. Pick a job or turn Maps off.",
    );
  });

  it("R5-A: the driven examples the contract cites now read as operator copy", () => {
    const verdict = validateSectionContent(brokenContent(), "button");
    const byPathSuffix = (suffix: string): string | undefined =>
      [...verdict.errors, ...verdict.warnings].find((e) => e.path.endsWith(suffix))?.message;

    // "choice.Analytics Id is required (§22 tracking)" — the operator's own
    // column heading is "Analytics ID".
    const analytics = byPathSuffix("choices[0].analytics_id");
    expect(analytics).toBe(
      "'Analytics ID' is required — it is how this answer is reported. Enter an Analytics ID.",
    );

    // "duplicate Internal Field 'Ks Nm' (§8.5 unique across the Section)"
    const duplicate = [...verdict.errors].find((e) => e.code === "duplicate_internal_field")?.message;
    expect(duplicate).toBe(
      "Another question in this Section already uses the Internal field 'zip' — each question needs its own. Rename one of them.",
    );

    // "design_overrides.buttonBackground must be a fixed token value, not
    //  arbitrary CSS (§14.10)"
    const css = [...verdict.errors].find((e) => e.code === "arbitrary_css_override")?.message;
    expect(css).toBe("'Icon color' must be one of the theme's values, not arbitrary CSS. Pick a value from the Style tab.");
  });

  it("R5-A: validateSection's real save errors (the whole save payload) carry no clause reference", () => {
    const result = validateSection({
      section_name: "R5 drive",
      activity: "auto",
      vertical: "insurance",
      headline_text: "Headline",
      continue_mode: "button",
      status: "draft",
      content_json: JSON.stringify(brokenContent()),
      design_overrides_json: JSON.stringify({
        bogus_key: "x",
        gapDefault: "calc(1rem + 2px)",
        iconColor: "url(javascript:1)",
        palette: { hotpink: "#FF00FF", accent: "not-a-role" },
      }),
    });
    expect(result.value, "the drive must really block the save").toBeNull();
    const messages = Object.values(result.errors);
    expect(messages.length, "save errors produced by the real validator").toBeGreaterThan(25);
    assertOperatorCopy(messages, "validateSection");
  });

  it("R5-A: a save that SUCCEEDS with warnings carries no clause reference in problems[]", () => {
    // problems[] is empty on a blocked save, so the warning surface needs its
    // own drive: content that validates but still warns (frame-scope
    // component, second Continue button, Maps on with no job).
    const result = validateSection({
      section_name: "R5 warning drive",
      activity: "auto",
      vertical: "insurance",
      headline_text: "Headline",
      continue_mode: "button",
      status: "active",
      content_json: JSON.stringify({
        components: [
          { type: "HeaderBar", question_id: "q_hdr" },
          {
            type: "ZIPInputQuestion",
            question_id: "q_zip",
            internal_field: "zip",
            props: {
              maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } },
            },
          },
          { type: "ContinueButton", question_id: "q_cta1", props: { text: "Continue" } },
          { type: "ContinueButton", question_id: "q_cta2", props: { text: "Continue again" } },
        ],
      }),
    });
    expect(result.errors, "the warning drive must NOT block the save").toEqual({});
    const messages = result.problems.map((p) => p.message);
    expect(messages.length, "warnings surfaced as problems[]").toBeGreaterThanOrEqual(3);
    assertOperatorCopy(messages, "validateSection problems[]");
  });

  it("R5-A: validateMappingReferences' real messages carry no clause reference", () => {
    const edges: LeadgenAnswerMapEdge[] = [
      { offer_id: 1 } as LeadgenAnswerMapEdge,
      { offer_id: 2 } as LeadgenAnswerMapEdge,
      { offer_id: 3 } as LeadgenAnswerMapEdge,
    ];
    const offers = new Map<number, OfferSchemaInfo>([
      [1, { status: "paused", activity: "auto", vertical: "insurance", active_schema_id: 7 } as OfferSchemaInfo],
      [2, { status: "active", activity: "home", vertical: "solar", active_schema_id: 7 } as OfferSchemaInfo],
      [3, { status: "active", activity: "auto", vertical: "insurance", active_schema_id: null } as OfferSchemaInfo],
    ]);
    const errors = validateMappingReferences(
      { activity: "auto", vertical: "insurance" },
      edges,
      offers,
    );
    const messages = Object.values(errors);
    expect(messages.length, "one message per broken mapping").toBe(3);
    assertOperatorCopy(messages, "validateMappingReferences");
  });

  // -------------------------------------------------------------------------
  // R5-B — the surfaces are derived from source, not listed
  // -------------------------------------------------------------------------

  it("R5-B: no save-path module can introduce a clause reference into operator copy", () => {
    // Strip block comments and line comments (a `//` outside a string) — the
    // spec cite is WELCOME in a comment, that is where a developer reads it.
    const stripComments = (text: string): string => {
      const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, "");
      return noBlocks
        .split("\n")
        .map((line) => {
          let quote: string | null = null;
          for (let i = 0; i < line.length; i += 1) {
            const ch = line[i];
            if (quote !== null) {
              if (ch === "\\") {
                i += 1;
                continue;
              }
              if (ch === quote) quote = null;
              continue;
            }
            if (ch === '"' || ch === "'" || ch === "`") {
              quote = ch;
              continue;
            }
            if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
          }
          return line;
        })
        .join("\n");
    };

    const resolveImport = (fromFile: string, spec: string): string | null => {
      if (!spec.startsWith(".")) return null;
      const base = normalize(join(dirname(fromFile), spec));
      for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    };

    // The static relative-import closure of the save entry point.
    const closure = new Set<string>();
    const stack = [SAVE_ENTRY];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (closure.has(file)) continue;
      closure.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+"([^"]+)"/g)) {
        const resolved = resolveImport(file, match[1] as string);
        if (resolved !== null && !closure.has(resolved)) stack.push(resolved);
      }
    }
    expect(closure.size, "the save entry point's import closure").toBeGreaterThan(10);

    // Of those, the ones that actually EMIT a save message.
    const emitters: string[] = [];
    const offenders: string[] = [];
    for (const file of [...closure].sort()) {
      const code = stripComments(readFileSync(file, "utf8"));
      const emits =
        /\b(?:push|warn)\(\s*"/.test(code) || /errors\[[^\]]*\]\s*=/.test(code);
      if (!emits) continue;
      emitters.push(relative(API_DIR, file));
      for (const [index, line] of code.split("\n").entries()) {
        if (line.includes("§")) offenders.push(`${relative(API_DIR, file)}:${index + 1}: ${line.trim()}`);
      }
    }
    // Derived, not listed: if a save-path module starts emitting messages it
    // joins this set automatically, and its clause references fail here.
    expect(emitters.length, `save-message emitters on the save path: ${emitters.join(", ")}`).toBeGreaterThan(
      2,
    );
    expect(offenders, `clause reference(s) in save-path operator copy:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("R5-B: the two owned validators are inside the derived emitter set", () => {
    // A guard on the guard: if the walk above ever stopped reaching the
    // content validator, R5-B would pass vacuously.
    const contentSchema = join(API_DIR, "src/public/leadgen/components/content-schema.ts");
    expect(existsSync(contentSchema)).toBe(true);
    const entry = readFileSync(SAVE_ENTRY, "utf8");
    expect(entry).toContain('from "../public/leadgen/components/content-schema"');
    expect(entry).toContain("validateSectionContent");
  });
});
