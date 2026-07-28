// LeadGen R2 — P1 §① slice S1c: the QUESTION-GRID studio editor.
//
// Two levels of proof, the repo's existing discipline (leadgen-p3b /
// leadgen-rework-studio):
//   (1) SSR level — the REAL exported render functions + the REAL served meta
//       blob (studioTypeMeta), never a hand-typed expectation of them.
//   (2) EXECUTED ISLAND — the editor's own functions SLICED FROM THE SHIPPED
//       SECTION_STUDIO_SCRIPT bytes and run against a fake DOM, so a typo'd
//       hook or a missing wire fails RED even when the SSR markup is fine.
//
// The two owner-probe regressions (A3, A4) and the two replay rows (R2, R3) are
// proved FAIL-BEFORE / PASS-AFTER inside one test each: the "before" build is
// the SHIPPED function text with the fix's OWN one line swapped back to its
// pre-fix form (an exact, asserted, single-occurrence replacement — never a
// hand-copied re-implementation), so deleting the fix from the product turns
// these red twice over.
//
// Live authoring (drag, click, screenshots) is the phase's product-proof gate;
// this file proves the model + DOM wiring.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  renderStudioInspector,
  renderStudioLibrary,
  studioTypeMeta,
  componentSeedTemplates,
  SECTION_STUDIO_SCRIPT,
} from "../src/admin/leadgen/ui-section-studio";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import {
  validateSectionContent,
  isLayoutContainerType,
  LEADGEN_QUESTION_GRID_TYPE,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

const DESIGN = getFunnelDesign(null);
const EMPTY_CONTENT = { components: [] } as unknown as LeadgenSectionContent;
const INSPECTOR = renderStudioInspector(DESIGN, "sec_grid");
const LIBRARY = renderStudioLibrary(DESIGN, EMPTY_CONTENT);
const META = studioTypeMeta();

// --- island slicing (the SHIPPED script text, not the .ts source) -----------

function slice(name: string): string {
  const marker = `function ${name}(`;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = SECTION_STUDIO_SCRIPT.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    if (SECTION_STUDIO_SCRIPT[i] === "{") depth += 1;
    else if (SECTION_STUDIO_SCRIPT[i] === "}") {
      depth -= 1;
      if (depth === 0) return SECTION_STUDIO_SCRIPT.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}
// Exactly-once source surgery: turns ONE shipped line back into its pre-fix
// form. The count assertion means "the fix is still in the product" — remove
// the fix and this throws before the behavioral leg even runs.
function withPreFix(source: string, shipped: string, preFix: string): string {
  const hits = source.split(shipped).length - 1;
  expect(hits, `the shipped fix line is present exactly once:\n${shipped}`).toBe(1);
  return source.split(shipped).join(preFix);
}

// --- a minimal fake DOM (no jsdom in this suite's deps) ---------------------

const ATTR_SELECTOR = /^\[([\w-]+)(?:="([^"]*)")?\]$/;

interface AttrMap {
  [k: string]: string;
}
class El {
  tagName: string;
  className = "";
  attrs: AttrMap = {};
  childNodes: El[] = [];
  parentNode: El | null = null;
  listeners: Record<string, Array<() => void>> = {};
  value = "";
  hidden = false;
  checked = false;
  selected = false;
  multiple = false;
  type = "";
  private _text = "";
  constructor(tagName: string) {
    this.tagName = tagName;
  }
  get textContent(): string {
    if (this._text !== "") return this._text;
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this._text = v;
    this.childNodes = [];
  }
  get options(): El[] {
    return this.childNodes.filter((c) => c.tagName === "option");
  }
  get firstChild(): El | null {
    return this.childNodes[0] ?? null;
  }
  appendChild(c: El): El {
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  insertBefore(c: El, ref: El | null): El {
    c.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(c);
    else this.childNodes.splice(at, 0, c);
    return c;
  }
  removeChild(c: El): El {
    const at = this.childNodes.indexOf(c);
    if (at >= 0) this.childNodes.splice(at, 1);
    c.parentNode = null;
    return c;
  }
  get nextSibling(): El | null {
    if (!this.parentNode) return null;
    const at = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[at + 1] ?? null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k]! : null;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(ev: string, fn: () => void): void {
    (this.listeners[ev] ??= []).push(fn);
  }
  fire(ev: string): void {
    for (const fn of this.listeners[ev] ?? []) fn.call(this);
  }
  cloneNode(_deep?: boolean): El {
    const c = new El(this.tagName);
    c.className = this.className;
    c.attrs = { ...this.attrs };
    c.value = this.value;
    c.hidden = this.hidden;
    c.multiple = this.multiple;
    c.type = this.type;
    for (const k of this.childNodes) c.appendChild(k.cloneNode(true));
    return c;
  }
  matches(sel: string): boolean {
    const m = sel.match(ATTR_SELECTOR);
    if (!m) return false;
    const v = this.getAttribute(m[1]!);
    if (v === null) return false;
    return m[2] === undefined || v === m[2];
  }
  descendants(): El[] {
    const out: El[] = [];
    for (const c of this.childNodes) {
      out.push(c);
      out.push(...c.descendants());
    }
    return out;
  }
  querySelectorAll(sel: string): El[] {
    return this.descendants().filter((d) => d.matches(sel));
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
function makeDoc(): { doc: Record<string, unknown>; root: El } {
  const root = new El("body");
  const doc = {
    createElement: (t: string) => new El(t),
    createTextNode: (t: string) => {
      const n = new El("#text");
      n.textContent = t;
      return n;
    },
    getElementById: () => null,
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
  };
  return { doc, root };
}
// The inspector shell the grid editor writes into (the SSR block's own hooks).
function mountGridBlock(root: El): void {
  const list = new El("div");
  list.setAttribute("data-grid-questions-list", "");
  const empty = new El("p");
  empty.setAttribute("data-grid-questions-empty", "");
  const typeProto = new El("select");
  typeProto.setAttribute("data-grid-type-proto", "");
  for (const t of Object.keys(COMPONENT_CATALOG)) {
    if (COMPONENT_CATALOG[t as keyof typeof COMPONENT_CATALOG].category !== "question") continue;
    const o = new El("option");
    o.value = t;
    o.textContent = t;
    typeProto.appendChild(o);
  }
  const opProto = new El("select");
  opProto.setAttribute("data-grid-op-proto", "");
  for (const op of ["eq", "neq", "in", "not_in", "gt", "lt", "range"]) {
    const o = new El("option");
    o.value = op;
    o.textContent = op;
    opProto.appendChild(o);
  }
  root.appendChild(list);
  root.appendChild(empty);
  root.appendChild(typeProto);
  root.appendChild(opProto);
}

// The island functions the grid editor really needs, sliced from the shipped
// script. Order is irrelevant (function declarations hoist inside the vm).
const GRID_FUNCS = [
  "trimStr",
  "cloneJson",
  "newQuestionId",
  "typeMeta",
  "isContainerType",
  "isQuestionGroupType",
  "isQuestionType",
  "typeLabel",
  "capsOf",
  "cap",
  "clearChildren",
  "appendOption",
  "walkTree",
  "findRefIn",
  "findRef",
  "selectedNode",
  "fieldExists",
  "uniqueFieldName",
  "internalFieldsOf",
  "refFieldInfo",
  "sectionFieldLabels",
  "currentHeadlineText",
  "conditionValueLabel",
  "conditionSentence",
  "typedScalar",
  "splitTypedList",
  "buildConditional",
  "ensureObj",
  "cleanupEmpty",
  "slugify",
  "sampleChoice",
  "defaultTextFor",
  "bindForType",
  "findBoundNode",
  "makeNode",
  "addComponentAt",
  "moveWithin",
  "removeNode",
  "defaultKindOf",
  "fillChoiceDefaultOptions",
  "gridQuestionsOf",
  "gridQuestionLabel",
  "gridQuestionDefault",
  "setGridQuestionDefault",
  "gridDepOf",
  "applyGridDep",
  "gridDepValueKind",
  "gridAppendChoiceOptions",
  "gridSelectedMulti",
  "gridSetMulti",
  "gridEl",
  "gridLabelled",
  "gridSmallBtn",
  "buildGridQuestionRow",
  "buildGridDependencyRow",
  "gridDepTriggerLabel",
  "gridSyncTriggerLabels",
  "renderGridQuestionsEditor",
  "setGridQuestionType",
  "addQuestionToGrid",
  "removeGridQuestion",
  "moveGridQuestion",
  "selectedQuestionGrid",
  "makeStarterYesNo",
  "insertQuestionsOnOneScreen",
];
const GRID_STUBS = [
  "function afterModelChange() { changes += 1; }",
  "function showRefusal(m) { refusals.push(m); }",
  "function selectComponent(qid) { selectedQuestionId = qid; selections.push(qid); }",
  "function setInspectorTab(k) { tabs.push(k); }",
  "function updatePendingUi() {}",
];

interface GridSandbox {
  document: Record<string, unknown>;
  studioMeta: Record<string, unknown>;
  componentSeeds: Record<string, unknown>;
  state: { content: { components: unknown[] } };
  selectedQuestionId: string | null;
  pendingInsert: unknown;
  MAX_DEPTH: number;
  changes: number;
  refusals: string[];
  selections: string[];
  tabs: string[];
  [k: string]: unknown;
}
function bootGrid(
  content: unknown,
  selected: string | null,
): { sandbox: GridSandbox; root: El; run: (expr: string) => unknown } {
  const { doc, root } = makeDoc();
  mountGridBlock(root);
  const sandbox: GridSandbox = {
    document: doc,
    studioMeta: { max_depth: 4, types: META },
    componentSeeds: componentSeedTemplates(),
    state: { content: JSON.parse(JSON.stringify(content)) as { components: unknown[] } },
    selectedQuestionId: selected,
    pendingInsert: null,
    MAX_DEPTH: 4,
    changes: 0,
    refusals: [],
    selections: [],
    tabs: [],
  };
  runInNewContext([...GRID_STUBS, ...GRID_FUNCS.map(slice)].join("\n"), sandbox);
  return { sandbox, root, run: (expr: string) => runInNewContext(expr, sandbox) };
}

// --- fixtures ---------------------------------------------------------------

// The owner's §A.4 reference screen, authored as the CONTAINER: Yes/No →
// dependent dropdown → buttons → Yes/No (contract §2 acceptance: the trigger
// may be ANY question type with ANY values).
const GRID_CONTENT = {
  components: [
    {
      type: LEADGEN_QUESTION_GRID_TYPE,
      question_id: "g1",
      props: { gap: "m" },
      children: [
        {
          type: "TwoButtonYesNo",
          question_id: "q1",
          internal_field: "currently_insured",
          answer_type: "boolean",
          props: { label: "Are you currently insured?" },
        },
        {
          type: "DropdownQuestion",
          question_id: "q2",
          internal_field: "current_insurer",
          answer_type: "enum",
          required: true,
          choices: [
            { label: "Geico", value: "geico", analytics_id: "geico" },
            { label: "Progressive", value: "progressive", analytics_id: "progressive" },
          ],
          props: { label: "Who is your current insurer?", default: "geico" },
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
        {
          type: "ButtonAnswerGroup",
          question_id: "q3",
          internal_field: "credit_score",
          answer_type: "enum",
          choices: [
            { label: "Excellent", value: "excellent", analytics_id: "excellent" },
            { label: "Fair", value: "fair", analytics_id: "fair" },
            { label: "Poor", value: "poor", analytics_id: "poor" },
          ],
          props: { label: "Credit Score" },
        },
        {
          type: "TwoButtonYesNo",
          question_id: "q4",
          internal_field: "accidents_3y",
          answer_type: "boolean",
          props: { label: "Accidents in the last 3 years?" },
        },
      ],
    },
    { type: "ContinueButton", question_id: "cta", props: { label: "Continue" } },
  ],
};

// =============================================================================
// SSR — the catalog rows S1a's handoff needs + the Content-tab block
// =============================================================================

describe("R2 P1 §① — SSR: the QuestionGrid studio rows", () => {
  it("STUDIO_TYPE_META carries the owner's name + a description that names NO container-level question control", () => {
    const blob = META["QuestionGrid"]!;
    expect(blob.label).toBe("Question grid");
    expect(blob.description.length).toBeGreaterThan(0);
    for (const dead of ["main question", "helper text", "answer format", "sub question", "sub-question"]) {
      expect(blob.description.toLowerCase()).not.toContain(dead);
    }
  });

  it("CONTENT_PROP_FIELDS is EMPTY for the container (no shared helper / format / label) and the capability row is all-blank", () => {
    expect(META["QuestionGrid"]!.content_props).toEqual([]);
    const caps = META["QuestionGrid"]!.capabilities as unknown as Record<string, unknown>;
    expect(caps["label_helper"]).toBe(false);
    expect(caps["required"]).toBe(false);
    expect(caps["choices_editor"]).toBe(false);
    expect(caps["other_editor"]).toBe(false);
    expect(caps["default_kind"]).toBe(null);
    expect(caps["placeholder"]).toBe(false);
  });

  it("the meta blob projects the two catalog-derived flags the island needs (question_group / question), for EVERY type", () => {
    for (const type of Object.keys(COMPONENT_CATALOG)) {
      const cat = COMPONENT_CATALOG[type as keyof typeof COMPONENT_CATALOG].category;
      expect(META[type]!.question_group, `${type}.question_group`).toBe(cat === "question_group");
      expect(META[type]!.question, `${type}.question`).toBe(cat === "question");
      // the LAYOUT-only flag is unchanged by this slice: still EXACTLY
      // isLayoutContainerType (a layout LEAF like Spacer is not a container).
      expect(META[type]!.container, `${type}.container`).toBe(isLayoutContainerType(type));
    }
  });

  it("the palette ships EXACTLY ONE grid-bearing tile and it inserts the container type", () => {
    expect((LIBRARY.match(/data-add-starter="questions_one_screen"/g) ?? []).length).toBe(1);
    expect((LIBRARY.match(/data-add-component="QuestionGrid"/g) ?? []).length).toBe(1);
  });

  it("the Content tab renders the questions-list block, and its '+ Add a question' affordance is OUTSIDE the list (owner A.1 #1)", () => {
    expect(INSPECTOR).toContain("data-content-questiongrid-block");
    expect(INSPECTOR).toContain("data-grid-questions-list");
    expect(INSPECTOR).toContain("data-grid-add-question");
    const block = INSPECTOR.slice(
      INSPECTOR.indexOf("data-content-questiongrid-block"),
      INSPECTOR.indexOf("data-content-field-block"),
    );
    const listAt = block.indexOf("data-grid-questions-list");
    const addAt = block.indexOf("data-grid-add-question");
    expect(listAt).toBeGreaterThan(-1);
    expect(addAt).toBeGreaterThan(listAt);
    const listEl = block.slice(listAt, block.indexOf("</div>", listAt));
    expect(listEl).not.toContain("data-grid-add-question");
  });

  it("NO DEAD PARTS: the questions-list block names no Main question / shared Helper text / shared Answer format / sub-questions", () => {
    const block = INSPECTOR.slice(
      INSPECTOR.indexOf("data-content-questiongrid-block"),
      INSPECTOR.indexOf("data-content-field-block"),
    );
    const body = block.replace(/<!--[\s\S]*?-->/g, "").toLowerCase();
    for (const dead of ["main question", "helper text", "answer format", "sub question", "sub-question", "subquestion"]) {
      expect(body, `dead part "${dead}" must not appear in the grid editor`).not.toContain(dead);
    }
  });

  it("the operator words for the 7 owner operators ride the block's op prototype (is / is not / one of / not one of / greater than / less than / between)", () => {
    const proto = INSPECTOR.slice(INSPECTOR.indexOf("data-grid-op-proto"));
    const opts = proto.slice(0, proto.indexOf("</select>"));
    for (const [value, word] of [
      ["eq", "is"],
      ["neq", "is not"],
      ["in", "one of"],
      ["not_in", "not one of"],
      ["gt", "greater than"],
      ["lt", "less than"],
      ["range", "between"],
    ]) {
      expect(opts).toContain(`<option value="${value}">${word}</option>`);
    }
    // no operator OUTSIDE the owner's set is offered in the grid picker
    expect(opts).not.toContain('value="gte"');
    expect(opts).not.toContain('value="lte"');
  });
});

// =============================================================================
// EXECUTED — the questions list
// =============================================================================

describe("R2 P1 §① — EXECUTED: the questions list", () => {
  it("renders ONE row per child question, each with its own type / label / field / default / required controls", () => {
    const { root, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    const rows = root.querySelectorAll("[data-grid-question-row]");
    expect(rows.length, "one row per question").toBe(4);
    expect(rows.map((r) => r.getAttribute("data-grid-question-row"))).toEqual(["q1", "q2", "q3", "q4"]);
    for (const row of rows) {
      expect(row.querySelector('[data-grid-q-field="type"]'), "type picker").not.toBeNull();
      expect(row.querySelector('[data-grid-q-field="label"]'), "label input").not.toBeNull();
      expect(row.querySelector('[data-grid-q-field="internal_field"]'), "field-name input").not.toBeNull();
      expect(row.querySelector('[data-grid-q-field="required"]'), "required toggle").not.toBeNull();
      expect(row.querySelector("[data-grid-q-style]"), "per-question style deviation").not.toBeNull();
      expect(row.querySelector("[data-grid-dep-row]"), "dependency editor").not.toBeNull();
    }
    // per-question DEFAULT — every question that HAS a default kind offers one
    // (owner A.1 #1: "right now only the first question has option for default")
    const withDefault = rows.filter((r) => r.querySelector('[data-grid-q-field="default"]') !== null);
    expect(withDefault.map((r) => r.getAttribute("data-grid-question-row"))).toEqual(["q1", "q2", "q3", "q4"]);
    // the reuse seams: the deep choices editor is REACHED, never rebuilt
    expect(rows[1]!.querySelector("[data-grid-q-answers]"), "dropdown reaches the existing choices editor").not.toBeNull();
    expect(rows[0]!.querySelector("[data-grid-q-answers]"), "Yes/No has no choices editor").toBeNull();
  });

  it("each row's controls WRITE that question only (label / field / required / default), and the tree stays save-valid", () => {
    const { sandbox, root, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    const labelIn = root.querySelector('[data-grid-question-row="q3"]')!.querySelector('[data-grid-q-field="label"]')!;
    labelIn.value = "Your credit score";
    labelIn.fire("input");
    const fieldIn = root
      .querySelector('[data-grid-question-row="q3"]')!
      .querySelector('[data-grid-q-field="internal_field"]')!;
    fieldIn.value = "credit_band";
    fieldIn.fire("input");
    const reqCb = root.querySelector('[data-grid-question-row="q3"]')!.querySelector('[data-grid-q-field="required"]')!;
    reqCb.checked = true;
    reqCb.fire("change");
    const defSel = root.querySelector('[data-grid-question-row="q3"]')!.querySelector('[data-grid-q-field="default"]')!;
    defSel.value = "fair";
    defSel.fire("change");
    const q3 = run("findRef('q3').node") as Record<string, unknown>;
    expect((q3["props"] as Record<string, unknown>)["label"]).toBe("Your credit score");
    expect(q3["internal_field"]).toBe("credit_band");
    expect(q3["required"]).toBe(true);
    expect((q3["props"] as Record<string, unknown>)["defaultValue"]).toBe("fair");
    // nothing leaked onto the CONTAINER (the dead-parts rule, enforced live)
    const grid = run("findRef('g1').node") as Record<string, unknown>;
    expect(grid["internal_field"]).toBeUndefined();
    expect(grid["required"]).toBeUndefined();
    expect(grid["choices"]).toBeUndefined();
    expect(Object.keys(grid["props"] as Record<string, unknown>)).toEqual(["gap"]);
    expect(validateSectionContent(sandbox.state.content).errors).toEqual([]);
  });

  it("the type picker SWAPS a question in place — identity, field, words, requirement and rule survive; Buttons→Dropdown keeps the authored answers", () => {
    const { sandbox, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    run("setGridQuestionType('q3', 'DropdownQuestion')");
    const q3 = run("findRef('q3').node") as Record<string, unknown>;
    expect(q3["type"]).toBe("DropdownQuestion");
    expect(q3["question_id"]).toBe("q3");
    expect(q3["internal_field"]).toBe("credit_score");
    expect((q3["props"] as Record<string, unknown>)["label"]).toBe("Credit Score");
    expect((q3["choices"] as unknown[]).length).toBe(3);
    // swapping to a type with no answers drops them (no orphan choice list)
    run("setGridQuestionType('q3', 'TwoButtonYesNo')");
    const swapped = run("findRef('q3').node") as Record<string, unknown>;
    expect(swapped["type"]).toBe("TwoButtonYesNo");
    expect(swapped["choices"]).toBeUndefined();
    expect(validateSectionContent(sandbox.state.content).errors).toEqual([]);
  });

  it("'+ Add a question' appends INSIDE the group (never beside it) and the new question is save-valid", () => {
    const { sandbox, root, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    run("addQuestionToGrid(selectedNode())");
    expect(run("findRef('g1').node.children.length")).toBe(5);
    expect((sandbox.state.content.components as unknown[]).length, "the Section list is untouched").toBe(2);
    expect(root.querySelectorAll("[data-grid-question-row]").length, "the list re-renders").toBe(5);
    expect(validateSectionContent(sandbox.state.content).errors).toEqual([]);
  });

  it("a non-question component can never be added to the group (the save gate's rule, refused in the studio)", () => {
    const { sandbox, run } = bootGrid(GRID_CONTENT, "g1");
    expect(run("addComponentAt('CardPanel', 'g1', null, undefined, undefined)")).toBe(null);
    expect(sandbox.refusals.join(" ")).toContain("question group holds questions only");
    expect(run("findRef('g1').node.children.length")).toBe(4);
  });
});

// =============================================================================
// EXECUTED — §A.4: "HOW DO I SET DROPDOWN???" (the dependency, in question terms)
// =============================================================================

describe("R2 P1 §① — EXECUTED: the dependency editor speaks questions, not fields", () => {
  it("the trigger picker offers the SIBLING questions by their OWN labels (never a field id, never the section headline)", () => {
    const { root, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    const dep = root.querySelector('[data-grid-dep-row="q2"]')!;
    const when = dep.querySelector('[data-grid-dep="when"]')!;
    expect(when.options.map((o) => o.textContent)).toEqual([
      "— always shown —",
      "Are you currently insured?",
      "Credit Score",
      "Accidents in the last 3 years?",
    ]);
    // the stored contract is still the sibling's FIELD
    expect(when.options.map((o) => o.value)).toEqual(["", "currently_insured", "credit_score", "accidents_3y"]);
    expect(when.value).toBe("currently_insured");
  });

  it("the VALUE picker offers the TRIGGER question's own authored answers — a NON-BOOLEAN Buttons trigger offers its values, a Yes/No trigger offers true/false", () => {
    const { root, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    // q4 depends on q3 (Buttons, non-boolean answers) with "one of"
    const dep4 = root.querySelector('[data-grid-dep-row="q4"]')!;
    const when4 = dep4.querySelector('[data-grid-dep="when"]')!;
    when4.value = "credit_score";
    when4.fire("change");
    const op4 = dep4.querySelector('[data-grid-dep="op"]')!;
    op4.value = "in";
    op4.fire("change");
    const multi = dep4.querySelector('[data-grid-dep="values-enum"]')!;
    expect(multi.hidden, "the multi picker is the value control for 'one of'").toBe(false);
    expect(
      multi.options.map((o) => o.value),
      "the TRIGGER's own values",
    ).toEqual(["excellent", "fair", "poor"]);
    expect(multi.options.map((o) => o.textContent)).toEqual(["Excellent", "Fair", "Poor"]);
    // true/false is offered ONLY where the trigger really is a Yes/No
    expect(dep4.querySelector('[data-grid-dep="value-bool"]')!.hidden).toBe(true);
    const dep2 = root.querySelector('[data-grid-dep-row="q2"]')!;
    const bool2 = dep2.querySelector('[data-grid-dep="value-bool"]')!;
    expect(bool2.hidden, "a Yes/No trigger gets the boolean picker").toBe(false);
    expect(bool2.options.map((o) => o.value)).toEqual(["true", "false"]);
    expect(dep2.querySelector('[data-grid-dep="values-enum"]')!.hidden).toBe(true);
  });

  it("authoring 'show this question when Credit Score is one of [Fair, Poor]' stores the schema conditional and the save gate accepts it", () => {
    const { sandbox, root, run } = bootGrid(GRID_CONTENT, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    run("addQuestionToGrid(selectedNode())");
    const newId = run("findRef('g1').node.children[4].question_id") as string;
    run(`setGridQuestionType(${JSON.stringify(newId)}, 'ButtonAnswerGroup')`);
    const dep = root.querySelector(`[data-grid-dep-row="${newId}"]`)!;
    const when = dep.querySelector('[data-grid-dep="when"]')!;
    when.value = "credit_score";
    when.fire("change");
    const op = dep.querySelector('[data-grid-dep="op"]')!;
    op.value = "in";
    op.fire("change");
    const multi = dep.querySelector('[data-grid-dep="values-enum"]')!;
    for (const o of multi.options) o.selected = o.value === "poor" || o.value === "fair";
    multi.fire("change");
    const node = run(`findRef(${JSON.stringify(newId)}).node`) as Record<string, unknown>;
    expect(node["conditional"]).toEqual({ when: "credit_score", op: "in", values: ["fair", "poor"] });
    // the readable sentence speaks the trigger's QUESTION words + answer words
    const sentence = dep.querySelector("[data-grid-dep-sentence]")!.textContent;
    expect(sentence).toContain("Credit Score");
    expect(sentence).toContain("one of");
    expect(sentence).toContain("Fair");
    expect(validateSectionContent(sandbox.state.content).errors).toEqual([]);
  });

  it("clearing the trigger removes the dependency; a multi-condition rule authored in the Rules tab is PRESERVED (row 0 only)", () => {
    const composed = JSON.parse(JSON.stringify(GRID_CONTENT)) as typeof GRID_CONTENT;
    (composed.components[0]!.children as Array<Record<string, unknown>>)[1]!["conditional"] = {
      match: "all",
      conditions: [
        { when: "currently_insured", op: "eq", value: true },
        { when: "credit_score", op: "eq", value: "excellent" },
      ],
    };
    const { root, run } = bootGrid(composed, "g1");
    run("renderGridQuestionsEditor(selectedNode())");
    const when = root.querySelector('[data-grid-dep-row="q2"]')!.querySelector('[data-grid-dep="when"]')!;
    when.value = "";
    when.fire("change");
    expect(
      (run("findRef('q2').node") as Record<string, unknown>)["conditional"],
      "the OTHER condition survives, collapsed to a single rule",
    ).toEqual({ when: "credit_score", op: "eq", value: "excellent" });
  });
});

// =============================================================================
// PROBE A3 — the Default select vs in-session choice edits (fail-before/after)
// =============================================================================

describe("R2 P1 §① — PROBE A3 regression: the Default list reflects an in-session choice rename", () => {
  const A3_SHIPPED = "if (typeof populateDefaultControls === 'function') { populateDefaultControls(node); }";
  const CONTENT_A3 = {
    components: [
      {
        type: "DropdownQuestion",
        question_id: "d1",
        internal_field: "insurer",
        answer_type: "enum",
        choices: [{ label: "Geico", value: "geico", analytics_id: "geico" }],
        props: { label: "Insurer", default: "geico" },
      },
    ],
  };
  // A choice-row DOM whose ONE row already carries the RENAMED label, plus the
  // real [data-default-control="dropdown"] select the inspector renders.
  function bootA3(collectSource: string): { defSel: El; run: (e: string) => unknown } {
    const { doc, root } = makeDoc();
    const container = new El("div");
    container.setAttribute("data-inspector-choices", "");
    const row = new El("div");
    row.setAttribute("data-choice-row", "");
    for (const [f, v] of [
      ["label", "Geico Insurance"],
      ["value", "geico"],
      ["analytics_id", "geico"],
    ]) {
      const inp = new El("input");
      inp.setAttribute("data-choice-field", f!);
      inp.value = v!;
      row.appendChild(inp);
    }
    container.appendChild(row);
    const wrap = new El("div");
    wrap.setAttribute("data-default-wrap", "dropdown");
    const defSel = new El("select");
    defSel.setAttribute("data-default-control", "dropdown");
    wrap.appendChild(defSel);
    root.appendChild(container);
    root.appendChild(wrap);
    const sandbox: Record<string, unknown> = {
      document: doc,
      studioMeta: { max_depth: 4, types: META },
      state: { content: JSON.parse(JSON.stringify(CONTENT_A3)) },
      selectedQuestionId: "d1",
      changes: 0,
    };
    runInNewContext(
      [
        "function afterModelChange() { changes += 1; }",
        ...[
          "trimStr",
          "typeMeta",
          "isContainerType",
          "capsOf",
          "cap",
          "clearChildren",
          "walkTree",
          "findRefIn",
          "findRef",
          "selectedNode",
          "defaultKindOf",
          "choiceContainer",
          "populateDefaultControls",
        ].map(slice),
        collectSource,
      ].join("\n"),
      sandbox,
    );
    return { defSel, run: (e: string) => runInNewContext(e, sandbox) };
  }

  it("FAIL-BEFORE: without the collectChoices refresh the Default list still shows the OLD label; PASS-AFTER: the shipped code shows the new one", () => {
    const shipped = slice("collectChoices");
    // before: the exact shipped function MINUS its one fix line
    const before = bootA3(withPreFix(shipped, A3_SHIPPED, ""));
    before.run("populateDefaultControls(selectedNode())"); // the per-selection paint
    expect(before.defSel.options.map((o) => o.textContent)).toEqual(["No default — the visitor picks", "Geico"]);
    before.run("collectChoices()");
    expect(
      before.defSel.options.map((o) => o.textContent),
      "pre-fix: the renamed choice is NOT in the Default list until save+reload",
    ).toEqual(["No default — the visitor picks", "Geico"]);

    const after = bootA3(shipped);
    after.run("populateDefaultControls(selectedNode())");
    after.run("collectChoices()");
    expect(
      after.defSel.options.map((o) => o.textContent),
      "shipped: the Default list reflects the in-session rename",
    ).toEqual(["No default — the visitor picks", "Geico Insurance"]);
    // …and the chosen default is preserved across the rebuild
    expect(after.defSel.value).toBe("geico");
  });
});

// =============================================================================
// PROBE A4 + replay R2 — the "when" list labels (fail-before/after)
// =============================================================================

describe("R2 P1 §① — PROBE A4 / replay R2 regression: every question is named by its OWN label", () => {
  const A4_SHIPPED =
    "var ownLabel = (node && node.props && typeof node.props.label === 'string' && trimStr(node.props.label) !== '') ? trimStr(node.props.label) : null;";
  const A4_PRE_FIX = "var ownLabel = null;";
  const R2_SHIPPED_WALK =
    "if ((isContainerType(node.type) || typeMeta(node.type).question_group === true) && node.children && node.children.length) {";
  const R2_PRE_FIX_WALK = "if (isContainerType(node.type) && node.children && node.children.length) {";

  const FLAT_TWINS = {
    components: [
      {
        type: "TwoButtonYesNo",
        question_id: "f1",
        internal_field: "currently_insured",
        answer_type: "boolean",
        props: { label: "Are you currently insured?" },
      },
      {
        type: "TwoButtonYesNo",
        question_id: "f2",
        internal_field: "accidents_3y",
        answer_type: "boolean",
        props: { label: "Accidents in the last 3 years?" },
      },
    ],
  };

  function labelsFor(content: unknown, headline: string, funcSource: string[]): Record<string, string> {
    const { doc } = makeDoc();
    const sandbox: Record<string, unknown> = {
      document: doc,
      studioMeta: { max_depth: 4, types: META },
      state: { content: JSON.parse(JSON.stringify(content)) },
      selectedQuestionId: null,
    };
    runInNewContext(funcSource.join("\n"), sandbox);
    return runInNewContext(`sectionFieldLabels(internalFieldsOf(), ${JSON.stringify(headline)})`, sandbox) as Record<
      string,
      string
    >;
  }
  const BASE = ["trimStr", "typeMeta", "isContainerType", "typeLabel", "walkTree"].map(slice);

  it("FAIL-BEFORE: the pre-fix labeller calls the FIRST question by the SECTION HEADLINE and its same-type sibling 'Yes / No'; PASS-AFTER: both read their own words", () => {
    const before = labelsFor(FLAT_TWINS, "Insurance Details", [
      ...BASE,
      slice("internalFieldsOf"),
      withPreFix(slice("sectionFieldLabels"), A4_SHIPPED, A4_PRE_FIX),
    ]);
    expect(before["currently_insured"], "pre-fix: the section headline mislabels question 1").toBe("Insurance Details");
    expect(before["accidents_3y"], "pre-fix: a bare type name for its sibling").toBe("Yes / No");

    const after = labelsFor(FLAT_TWINS, "Insurance Details", [
      ...BASE,
      slice("internalFieldsOf"),
      slice("sectionFieldLabels"),
    ]);
    expect(after["currently_insured"]).toBe("Are you currently insured?");
    expect(after["accidents_3y"]).toBe("Accidents in the last 3 years?");
  });

  it("replay R2 FAIL-BEFORE: the pre-fix walker cannot even SEE container-nested questions; PASS-AFTER: all four are rule sources under their own labels", () => {
    const before = labelsFor(GRID_CONTENT, "Insurance Details", [
      slice("trimStr"),
      slice("typeMeta"),
      slice("isContainerType"),
      slice("typeLabel"),
      withPreFix(slice("walkTree"), R2_SHIPPED_WALK, R2_PRE_FIX_WALK),
      slice("internalFieldsOf"),
      slice("sectionFieldLabels"),
    ]);
    expect(Object.keys(before), "pre-fix: a grid's questions are invisible to every rule picker").toEqual([]);

    const after = labelsFor(GRID_CONTENT, "Insurance Details", [
      ...BASE,
      slice("internalFieldsOf"),
      slice("sectionFieldLabels"),
    ]);
    expect(after).toEqual({
      currently_insured: "Are you currently insured?",
      current_insurer: "Who is your current insurer?",
      credit_score: "Credit Score",
      accidents_3y: "Accidents in the last 3 years?",
    });
  });

  it("the SECTION-level rule picker (populateConditional) offers the grid's nested questions by those same labels", () => {
    const { doc, root } = makeDoc();
    const whenSel = new El("select");
    whenSel.setAttribute("data-inspector-cond", "when");
    const opSel = new El("select");
    opSel.setAttribute("data-inspector-cond", "op");
    root.appendChild(whenSel);
    root.appendChild(opSel);
    const sandbox: Record<string, unknown> = {
      document: doc,
      studioMeta: { max_depth: 4, types: META },
      state: { content: JSON.parse(JSON.stringify(GRID_CONTENT)) },
      selectedQuestionId: "cta",
    };
    runInNewContext(
      [
        "function updateCondValueInputs() {}",
        ...[
          "trimStr",
          "typeMeta",
          "isContainerType",
          "typeLabel",
          "clearChildren",
          "walkTree",
          "findRefIn",
          "findRef",
          "selectedNode",
          "internalFieldsOf",
          "sectionFieldLabels",
          "currentHeadlineText",
          "populateConditional",
        ].map(slice),
      ].join("\n"),
      sandbox,
    );
    runInNewContext("populateConditional(selectedNode())", sandbox);
    expect(whenSel.options.map((o) => o.textContent)).toEqual([
      "— always visible —",
      "Are you currently insured?",
      "Who is your current insurer?",
      "Credit Score",
      "Accidents in the last 3 years?",
    ]);
  });
});

// =============================================================================
// Replay R3 — the starter honors the selected container
// =============================================================================

describe("R2 P1 §① — replay R3: the 'Questions on one screen' starter", () => {
  it("with a QuestionGrid SELECTED the two questions land INSIDE it (the container is never left empty)", () => {
    const EMPTY_GRID = { components: [{ type: LEADGEN_QUESTION_GRID_TYPE, question_id: "g0", children: [] }] };
    const { sandbox, run } = bootGrid(EMPTY_GRID, "g0");
    run("insertQuestionsOnOneScreen()");
    expect(run("findRef('g0').node.children.length")).toBe(2);
    expect((sandbox.state.content.components as unknown[]).length, "no loose components in the Section").toBe(1);
    expect(run("findRef('g0').node.children[0].props.label")).toBe("Question 1");
    expect(run("findRef('g0').node.children[1].internal_field")).toBe("answer2");
    expect(sandbox.selections[sandbox.selections.length - 1], "the group stays selected").toBe("g0");
    expect(validateSectionContent(sandbox.state.content).errors).toEqual([]);
  });

  it("with a CHILD question selected the pair still lands in that child's group (never ejected to the Section)", () => {
    const { sandbox, run } = bootGrid(GRID_CONTENT, "q2");
    run("insertQuestionsOnOneScreen()");
    expect(run("findRef('g1').node.children.length")).toBe(6);
    expect((sandbox.state.content.components as unknown[]).length).toBe(2);
  });

  it("with NOTHING selected it creates the CONTAINER and puts both questions inside (never two loose components)", () => {
    const { sandbox, run } = bootGrid({ components: [] }, null);
    run("insertQuestionsOnOneScreen()");
    const comps = sandbox.state.content.components as Array<Record<string, unknown>>;
    expect(comps.length).toBe(1);
    expect(comps[0]!["type"]).toBe(LEADGEN_QUESTION_GRID_TYPE);
    expect((comps[0]!["children"] as unknown[]).length).toBe(2);
    expect(validateSectionContent(sandbox.state.content).errors).toEqual([]);
  });
});

// =============================================================================
// The add affordance — a SIBLING AFTER the component root (owner A.1 #1)
// =============================================================================

describe("R2 P1 §① — the '+ Add a question' canvas affordance", () => {
  it("is inserted as a SIBLING immediately AFTER the group root, using the SAME ghost row/button as '+ Add choice'", () => {
    const src = slice("decorateChoiceCards");
    expect(src.indexOf("data-question-ghost"), "the question ghost exists").toBeGreaterThan(-1);
    const branch = src.slice(src.indexOf("question_group === true"));
    expect(branch).toContain("qGhostRow.className = 'studio-add-ghost-row'");
    expect(branch).toContain("qGhost.className = 'studio-add-ghost-btn'");
    expect(branch).toContain("+ Add a question");
    // SIBLING AFTER the root — never appendChild onto the component itself
    expect(branch).toContain("nodes[i].parentNode.insertBefore(qGhostRow, nodes[i].nextSibling)");
    expect(branch).not.toContain("nodes[i].appendChild(qGhostRow)");
  });

  it("EXECUTED: decorating a canvas region puts the ghost row AFTER the group node, as its next sibling, with the group's own DOM untouched", () => {
    const { doc, root } = makeDoc();
    const region = new El("div");
    const gridNode = new El("div");
    gridNode.setAttribute("data-question-id", "g1");
    gridNode.setAttribute("data-component-type", LEADGEN_QUESTION_GRID_TYPE);
    const childNode = new El("div");
    childNode.setAttribute("data-question-id", "q1");
    childNode.setAttribute("data-component-type", "TwoButtonYesNo");
    gridNode.appendChild(childNode);
    region.appendChild(gridNode);
    root.appendChild(region);
    const sandbox: Record<string, unknown> = {
      document: doc,
      studioMeta: { max_depth: 4, types: META },
      state: { content: JSON.parse(JSON.stringify(GRID_CONTENT)) },
      selectedQuestionId: null,
      selectedChoiceValue: null,
      region,
    };
    runInNewContext(
      [
        "function frameCreate(t) { return document.createElement(t); }",
        ...["typeMeta", "isContainerType"].map(slice),
        slice("decorateChoiceCards"),
      ].join("\n"),
      sandbox,
    );
    const beforeKids = gridNode.childNodes.length;
    runInNewContext("decorateChoiceCards(region)", sandbox);
    expect(gridNode.childNodes.length, "the component's OWN box is unchanged (no new child, no widening)").toBe(
      beforeKids,
    );
    const next = region.childNodes[region.childNodes.indexOf(gridNode) + 1];
    expect(next, "a ghost row follows the group root").toBeTruthy();
    expect(next!.getAttribute("data-add-ghost-row")).toBe("g1");
    expect(next!.className).toBe("studio-add-ghost-row");
    expect(next!.querySelector("[data-question-ghost]")!.textContent).toBe("+ Add a question");
    expect(gridNode.querySelector("[data-question-ghost]"), "never inside the component").toBeNull();
  });
});
