// Section Builder v3.1 REMEDIATION — phase R3 STAGE A (register S2-4/E1-NEW-2).
// The DRIFT-PROOF pin for the per-type choice-field gating: the island's
// CHOICE_FIELD_CONSUMPTION (which choice-editor fields each type shows) is
// re-derived from presets.ts SOURCE — exactly which choice fields each type's
// RENDERER consumes (c.<field>) — so a future renderer change that adds/drops a
// consumed choice field fails THIS test until the island map widens in lockstep
// (the same discipline as the SIZE_CONSUMING_TYPES pin in leadgen-r2-canvas).
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

const CHOICE_FIELDS = [
  "label",
  "value",
  "analytics_id",
  "title",
  "subtitle",
  "badge",
  "icon",
  "emoji",
  "imageMediaId",
  "image_alt",
  "aria_label",
  "description",
];
// The 7 CHOICE types (a choices editor exists — meta.choice). TwoButtonYesNo is
// NOT a choice type (fixed Yes/No), so it is not in CHOICE_FIELD_CONSUMPTION.
const CHOICE_TYPES = [
  "ButtonAnswerGroup",
  "DropdownQuestion",
  "SearchableDropdownQuestion",
  "OtherGroupSelector",
  "MultiChoiceCardGroup",
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
];

function presetsSrc(): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "public", "leadgen", "components", "presets.ts"),
    "utf8",
  );
}
function bracedBody(src: string, fnStartIdx: number): string | null {
  if (fnStartIdx < 0) return null;
  const open = src.indexOf("{", fnStartIdx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(fnStartIdx, i + 1);
    }
  }
  return null;
}
function fnBody(src: string, fnName: string): string | null {
  return bracedBody(src, src.indexOf("function " + fnName + "("));
}
// The choice fields a render-function body CONSUMES: any CHOICE_FIELD referenced
// as c.<field> / choice.<field> / c["<field>"].
function choiceFieldRefs(body: string): string[] {
  const out: string[] = [];
  for (const f of CHOICE_FIELDS) {
    const re = new RegExp('(?:\\bc|\\bchoice)(?:\\.' + f + '\\b|\\["' + f + '"\\])');
    if (re.test(body)) out.push(f);
  }
  return out.sort();
}
// type -> render function via the ONE renderComponent dispatch switch.
function typeToFn(src: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const cm of src.matchAll(/case "(\w+)":[\s\S]{0,200}?return (render\w+)\(/g)) {
    if (!m.has(cm[1]!)) m.set(cm[1]!, cm[2]!);
  }
  return m;
}
function derivedChoiceFields(type: string): string[] {
  const src = presetsSrc();
  const fn = typeToFn(src).get(type);
  expect(fn, `dispatch resolves ${type}`).toBeTruthy();
  let body = fnBody(src, fn!);
  expect(body, `${fn} body found`).toBeTruthy();
  // The two card grids delegate to renderCardGrid — follow that ONE hop.
  if (/return renderCardGrid\(/.test(body!)) {
    body = fnBody(src, "renderCardGrid");
    expect(body, "renderCardGrid body found").toBeTruthy();
  }
  return choiceFieldRefs(body!);
}

// The island's CHOICE_FIELD_CONSUMPTION, evaluated from the SHIPPED island bytes
// (CHOICE_FIELDS is referenced by the two card-grid entries, so eval both).
function islandConsumption(): Record<string, string[]> {
  function varLine(prefix: string): string {
    const start = SECTION_STUDIO_SCRIPT.indexOf(prefix);
    expect(start, `island "${prefix}" present`).toBeGreaterThan(-1);
    return SECTION_STUDIO_SCRIPT.slice(start, SECTION_STUDIO_SCRIPT.indexOf(";", start) + 1);
  }
  const sandbox: Record<string, unknown> = {};
  runInNewContext(
    [varLine("var CHOICE_FIELDS ="), varLine("var CHOICE_FIELD_CONSUMPTION ="), "this.OUT = CHOICE_FIELD_CONSUMPTION;"].join("\n"),
    sandbox,
  );
  return sandbox["OUT"] as Record<string, string[]>;
}

describe("R3 E1-NEW-2 — the per-type choice-field map is DERIVED from presets.ts consumption, not assumed", () => {
  const island = islandConsumption();
  for (const type of CHOICE_TYPES) {
    it(`${type}: island CHOICE_FIELD_CONSUMPTION equals the fields presets.ts actually consumes`, () => {
      const fromIsland = [...(island[type] || [])].sort();
      const fromPresets = derivedChoiceFields(type);
      expect(fromIsland).toEqual(fromPresets);
    });
  }

  it("the register's shape holds: BAG/DDQ/SDQ/OGS = label/value/analytics_id only; MCG adds title/subtitle; card grids get all 12", () => {
    const g = (t: string): string[] => [...(island[t] || [])].sort();
    expect(g("ButtonAnswerGroup")).toEqual(["analytics_id", "label", "value"]);
    expect(g("DropdownQuestion")).toEqual(["analytics_id", "label", "value"]);
    expect(g("SearchableDropdownQuestion")).toEqual(["analytics_id", "label", "value"]);
    expect(g("OtherGroupSelector")).toEqual(["analytics_id", "label", "value"]);
    expect(g("MultiChoiceCardGroup")).toEqual(["analytics_id", "label", "subtitle", "title", "value"]);
    expect(g("IconCardAnswerGrid")).toEqual([...CHOICE_FIELDS].sort());
    expect(g("ImageCardAnswerGrid")).toEqual([...CHOICE_FIELDS].sort());
  });

  it("TwoButtonYesNo is NOT a choice type — it has no CHOICE_FIELD_CONSUMPTION entry (fixed Yes/No)", () => {
    expect(island.TwoButtonYesNo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P2b (register R-A completion) — the SAME drift-proof discipline for
// CHOICE_STYLE_TYPES: which types' choice-editor row gets the per-choice
// Style popover (buildChoiceStyleControl, ui-section-studio.ts). Re-derived
// from presets.ts SOURCE — exactly which render function threads the per-
// CHOICE `style` (c.style) through choiceItemStyle — so a future renderer
// change that starts/stops threading c.style fails THIS test until
// CHOICE_STYLE_TYPES widens/narrows in lockstep. Deliberately NARROWER than
// CHOICE_TYPES/CHOICE_FIELD_CONSUMPTION above: DropdownQuestion and
// SearchableDropdownQuestion ARE choice types (a choices editor exists) but
// their renderer never calls choiceItemStyle at all (native <select>, no
// per-option paint) — the popover would be a no-op there. TwoButtonYesNo is
// the opposite asymmetry: its renderer DOES call choiceItemStyle, but with
// `cs` (props.yesStyle/noStyle) rather than a CHOICE's `c.style` — it has no
// `choices` array to attach a popover-bearing ROW to at all (its style
// controls are mounted separately — see populateYesNoStyleBlock).
// ---------------------------------------------------------------------------

// A render-function body threads the per-CHOICE style when it calls
// choiceItemStyle(...) with c.style as one of the arguments — deliberately
// distinct from a bare c.style reference ANYWHERE in the body (there is none
// today, but a future refactor could otherwise false-negative/false-positive
// on incidental proximity — matching this file's own "structural, not line-
// proximity" discipline for choiceFieldRefs above).
function threadsChoiceStyle(body: string): boolean {
  return /choiceItemStyle\([^)]*\bc\.style\b[^)]*\)/.test(body);
}

// Scans EVERY dispatched ComponentType (not just the pre-known CHOICE_TYPES
// list above) so a future renderer for an as-yet-unlisted type that starts
// threading c.style is discovered too, not just the 7 already suspected.
function derivedChoiceStyleTypes(): string[] {
  const src = presetsSrc();
  const out: string[] = [];
  for (const [type, fn] of typeToFn(src)) {
    let body = fnBody(src, fn);
    if (body === null) continue;
    // The two card grids delegate to renderCardGrid — follow that ONE hop
    // (the SAME hop derivedChoiceFields above follows).
    if (/return renderCardGrid\(/.test(body)) {
      body = fnBody(src, "renderCardGrid");
    }
    if (body !== null && threadsChoiceStyle(body)) out.push(type);
  }
  return out.sort();
}

// The island's CHOICE_STYLE_TYPES, evaluated from the SHIPPED island bytes —
// a self-contained `{ Type: 1, ... }` lookup map (no external var reference,
// so a single var-line eval suffices, unlike CHOICE_FIELD_CONSUMPTION above).
function islandChoiceStyleTypes(): Record<string, number> {
  const start = SECTION_STUDIO_SCRIPT.indexOf("var CHOICE_STYLE_TYPES =");
  expect(start, 'island "var CHOICE_STYLE_TYPES =" present').toBeGreaterThan(-1);
  const line = SECTION_STUDIO_SCRIPT.slice(start, SECTION_STUDIO_SCRIPT.indexOf(";", start) + 1);
  const sandbox: Record<string, unknown> = {};
  runInNewContext([line, "this.OUT = CHOICE_STYLE_TYPES;"].join("\n"), sandbox);
  return sandbox["OUT"] as Record<string, number>;
}

describe("P2b R-A completion — CHOICE_STYLE_TYPES is DERIVED from presets.ts's choiceItemStyle(..., c.style) call sites, not assumed", () => {
  it("the island's CHOICE_STYLE_TYPES key set equals the types whose renderer threads c.style through choiceItemStyle", () => {
    const island = Object.keys(islandChoiceStyleTypes()).sort();
    const derived = derivedChoiceStyleTypes();
    expect(island).toEqual(derived);
  });

  it("the register's shape holds: exactly the 6 per-choice families (incl. P5 MultiQuestionGrid, whose shared pills thread c.style); TwoButtonYesNo (yesStyle/noStyle, no choices array) and the 2 native-select dropdowns are excluded", () => {
    expect(derivedChoiceStyleTypes()).toEqual([
      "ButtonAnswerGroup",
      "IconCardAnswerGrid",
      "ImageCardAnswerGrid",
      "MultiChoiceCardGroup",
      "MultiQuestionGrid",
      "OtherGroupSelector",
    ]);
  });

  it("every island CHOICE_STYLE_TYPES value is the literal 1 (a Set-shaped lookup map, never a falsy/truthy-ambiguous marker)", () => {
    const island = islandChoiceStyleTypes();
    for (const k of Object.keys(island)) {
      expect(island[k], k).toBe(1);
    }
  });

  it("TwoButtonYesNo's renderer DOES call choiceItemStyle, but never with c.style (props.yesStyle/noStyle instead) — confirms the exclusion is a real asymmetry, not an oversight", () => {
    const src = presetsSrc();
    const fn = typeToFn(src).get("TwoButtonYesNo");
    expect(fn, "dispatch resolves TwoButtonYesNo").toBeTruthy();
    const body = fnBody(src, fn!);
    expect(body, `${fn} body found`).toBeTruthy();
    expect(body).toContain("choiceItemStyle(");
    expect(threadsChoiceStyle(body!)).toBe(false);
  });
});
