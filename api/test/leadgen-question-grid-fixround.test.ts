// LeadGen R2 — P1 FIX-FIRST round: the four defects the fresh-context
// adversarial drive of the owner's 18.30.25 scenario found, each pinned by the
// owner's OWN words (docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md A.1 #2,
// §A.4/§2, DEC-D4):
//
//   B1  "the operator AUTHORS in the real studio" (§A.4/§2) — typing a question
//       label into the grid row must simply work. It did not: every keystroke
//       rebuilt the whole editor, the input being typed into was destroyed,
//       focus fell to BODY and the text was lost.
//   B2  "if we set a 'default' and the user didn't change it - this is his
//       answer and the 'required' rule is met" — an authored dropdown/range
//       default was written to props.default, which the /lg/config projection
//       never read, so it never became an answer and Continue stayed blocked.
//   B3  "if the user clicked 'no' and the dependency rule wasn't met, we need
//       to ignore this question- it isn't relevant, so it doesn't exist and the
//       answer is not required" — the server re-added a HIDDEN question's
//       default to the normalized answers (and from there to the Offer payload
//       / provider request log): a fabricated answer the visitor never gave.
//   D4  (owner-RULED) per-question style deviation "Reuse the existing
//       per-section override axes incl. free colors" — the Style panel offered
//       theme roles only; free color had no control at all.
//
// PROOF SHAPE. The producers here are the REAL shipped artifacts: the island
// functions are SLICED FROM SECTION_STUDIO_SCRIPT's own bytes (never a
// re-typed copy), the projection/normalization/render legs are the real
// exported functions, and the studio markup is the real renderStudioInspector
// output. Where a fix lives in the island, its fail-before is an exact,
// asserted, single-occurrence source surgery that puts the shipped line back to
// its pre-fix form — delete the fix from the product and the test throws before
// its behavioral leg even runs. The answers.ts / config-dto.ts fail-before is a
// pre-fix RUN of this same file (recorded in the phase report; TS modules have
// no in-test surgery seam). Live authoring + the real provider-log row are the
// phase's product-proof gate, not this lane.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  renderStudioInspector,
  studioTypeMeta,
  componentSeedTemplates,
  SECTION_STUDIO_SCRIPT,
} from "../src/admin/leadgen/ui-section-studio";
import { quoteRailAnswerFields } from "../src/admin/leadgen/ui-quotes";
import type { AvailableSection } from "../src/admin/leadgen/quotes-tabs/shared";
import { toPublicComponent, projectSectionComponents } from "../src/public/leadgen/config-dto";
import { normalizeAnswers, generateOfferPayload } from "../src/leadgen/answers";
import { evaluateDependencies } from "../src/leadgen/dependencies";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import { validateSectionContent, LEADGEN_QUESTION_GRID_TYPE } from "../src/public/leadgen/components/content-schema";
import type {
  LeadgenComponentNode,
  LeadgenSectionContent,
} from "../src/public/leadgen/components/content-schema";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";

const DESIGN = getFunnelDesign(null);
const META = studioTypeMeta();
const INSPECTOR = renderStudioInspector(DESIGN, "sec_fixround");

// ---------------------------------------------------------------------------
// island slicing (the SHIPPED script text, not the .ts source)
// ---------------------------------------------------------------------------

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
function withPreFix(source: string, shipped: string, preFix: string): string {
  const hits = source.split(shipped).length - 1;
  expect(hits, `the shipped fix line is present exactly once:\n${shipped}`).toBe(1);
  return source.split(shipped).join(preFix);
}

// ---------------------------------------------------------------------------
// a FOCUS-AWARE fake DOM
//
// WHY focus is modeled here and nowhere else in this suite: a ".value = 'x' →
// fire('input')" test is STRUCTURALLY BLIND to the defect B1 describes. Setting
// .value programmatically re-reads the element the test still holds, so a
// mid-keystroke rebuild is invisible: the test's own reference keeps the text
// even after the live DOM threw that element away. Real typing does the
// opposite — each keystroke goes to document.activeElement, and a browser moves
// focus to <body> the moment the focused node is detached. So this DOM tracks
// activeElement, drops it to <body> on detach, and the typing helper below
// sends every character to whatever currently HAS focus. That is the only way
// the "26 keystrokes produced an empty field" class can fail red.
// ---------------------------------------------------------------------------

const ATTR_SELECTOR = /^\[([\w-]+)(?:="([^"]*)")?\]$/;

class El {
  tagName: string;
  className = "";
  attrs: Record<string, string> = {};
  childNodes: El[] = [];
  parentNode: El | null = null;
  listeners: Record<string, Array<() => void>> = {};
  value = "";
  hidden = false;
  checked = false;
  selected = false;
  multiple = false;
  type = "";
  doc: FakeDoc | null = null;
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
    c.doc = this.doc;
    for (const d of c.descendants()) d.doc = this.doc;
    this.childNodes.push(c);
    return c;
  }
  insertBefore(c: El, ref: El | null): El {
    c.parentNode = this;
    c.doc = this.doc;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(c);
    else this.childNodes.splice(at, 0, c);
    return c;
  }
  removeChild(c: El): El {
    const at = this.childNodes.indexOf(c);
    if (at >= 0) this.childNodes.splice(at, 1);
    c.parentNode = null;
    // The browser rule this whole harness exists for: detaching the focused
    // node (or an ancestor of it) drops focus to <body>.
    const doc = this.doc;
    if (doc !== null) {
      const lost = doc.activeElement === c || c.descendants().indexOf(doc.activeElement as El) >= 0;
      if (lost) doc.activeElement = doc.body;
    }
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
  focus(): void {
    if (this.doc !== null) this.doc.activeElement = this;
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

interface FakeDoc {
  body: El;
  activeElement: El;
  createElement: (t: string) => El;
  createTextNode: (t: string) => El;
  getElementById: () => null;
  querySelector: (sel: string) => El | null;
  querySelectorAll: (sel: string) => El[];
}

function makeDoc(): { doc: FakeDoc; root: El } {
  const root = new El("body");
  const doc: FakeDoc = {
    body: root,
    activeElement: root,
    createElement: (t: string) => {
      const el = new El(t);
      el.doc = doc;
      return el;
    },
    createTextNode: (t: string) => {
      const n = new El("#text");
      n.doc = doc;
      n.textContent = t;
      return n;
    },
    getElementById: () => null,
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
  };
  root.doc = doc;
  return { doc, root };
}

// REAL typing: character by character, each one delivered to whatever holds
// focus right now (exactly what a keyboard does). A character sent while focus
// sits on <body> is LOST — which is the live symptom the drive recorded.
function typeInto(doc: FakeDoc, text: string): { delivered: string; lost: number } {
  let delivered = "";
  let lost = 0;
  for (const ch of text) {
    const target = doc.activeElement;
    if (target.tagName !== "input") {
      lost += 1;
      continue;
    }
    target.value = target.value + ch;
    delivered += ch;
    target.fire("input");
  }
  return { delivered, lost };
}

// ---------------------------------------------------------------------------
// the grid editor's island, booted over the focus-aware DOM
// ---------------------------------------------------------------------------

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
  "gridDefaultStored",
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
  "renderGridQuestionsEditor",
  "setGridQuestionType",
  "addQuestionToGrid",
  "removeGridQuestion",
  "moveGridQuestion",
];
const GRID_STUBS = [
  "function afterModelChange() { changes += 1; }",
  "function showRefusal(m) { refusals.push(m); }",
  "function selectComponent(qid) { selectedQuestionId = qid; }",
  "function setInspectorTab(k) { tabs.push(k); }",
  "function updatePendingUi() {}",
];

// The pin's own screen: Yes/No trigger → dependent REQUIRED dropdown carrying
// an authored default → Buttons → Yes/No.
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
          props: { label: "Who is your current insurer?" },
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

interface GridBoot {
  doc: FakeDoc;
  root: El;
  sandbox: Record<string, unknown>;
  run: (expr: string) => unknown;
}
function bootGrid(content: unknown, selected: string | null, syncSource: string): GridBoot {
  const { doc, root } = makeDoc();
  mountGridBlock(root);
  const sandbox: Record<string, unknown> = {
    document: doc,
    studioMeta: { max_depth: 4, types: META },
    componentSeeds: componentSeedTemplates(),
    state: { content: JSON.parse(JSON.stringify(content)) as { components: unknown[] } },
    selectedQuestionId: selected,
    pendingInsert: null,
    MAX_DEPTH: 4,
    changes: 0,
    refusals: [],
    tabs: [],
  };
  runInNewContext([...GRID_STUBS, ...GRID_FUNCS.map(slice), syncSource].join("\n"), sandbox);
  return { doc, root, sandbox, run: (expr: string) => runInNewContext(expr, sandbox) };
}

// =============================================================================
// BLOCKER 1 — typing a question label
// =============================================================================

describe("R2 P1 FIX-FIRST · B1 — the operator can TYPE a question label", () => {
  // The pre-fix body did exactly one thing: rebuild the entire editor. Putting
  // that call back at the top of the SHIPPED function (with an immediate
  // return) restores the pre-fix behavior byte-for-byte, and the surgery's own
  // count assertion proves the fix is still in the product.
  const B1_SHIPPED = "var kids = gridQuestionsOf(grid);";
  const B1_PRE_FIX = "renderGridQuestionsEditor(grid); return;\n    var kids = gridQuestionsOf(grid);";
  const TYPED = "Are you currently insured?";

  function driveTyping(syncSource: string): {
    liveValue: string;
    modelLabel: unknown;
    focusIsInput: boolean;
    lost: number;
  } {
    const boot = bootGrid(GRID_CONTENT, "g1", syncSource);
    boot.run("renderGridQuestionsEditor(selectedNode())");
    const row = boot.root.querySelector('[data-grid-question-row="q1"]')!;
    const labelIn = row.querySelector('[data-grid-q-field="label"]')!;
    // start from an empty field, cursor in it — the operator clearing the seed
    // words and typing the question, exactly as the drive did.
    labelIn.value = "";
    labelIn.focus();
    const { lost } = typeInto(boot.doc, TYPED);
    const liveIn = boot.root
      .querySelector('[data-grid-question-row="q1"]')!
      .querySelector('[data-grid-q-field="label"]')!;
    const node = boot.run("findRef('q1').node") as { props?: Record<string, unknown> };
    return {
      liveValue: liveIn.value,
      modelLabel: node.props?.["label"],
      focusIsInput: boot.doc.activeElement === liveIn,
      lost,
    };
  }

  it("FAIL-BEFORE: the pre-fix per-keystroke rebuild destroys the input, focus falls to BODY and the text is lost; PASS-AFTER: all 25 characters land and focus never moves", () => {
    const before = driveTyping(withPreFix(slice("gridSyncTriggerLabels"), B1_SHIPPED, B1_PRE_FIX));
    expect(before.liveValue, "pre-fix: the field does NOT hold what was typed").not.toBe(TYPED);
    expect(before.lost, "pre-fix: keystrokes land on BODY (where the reorder keybindings live)").toBeGreaterThan(0);
    expect(before.focusIsInput, "pre-fix: focus is no longer in the input the operator is typing in").toBe(false);

    const after = driveTyping(slice("gridSyncTriggerLabels"));
    expect(after.lost, "shipped: not one keystroke is lost").toBe(0);
    expect(after.liveValue, "shipped: the field holds exactly what was typed").toBe(TYPED);
    expect(after.modelLabel, "shipped: the model carries the same words").toBe(TYPED);
    expect(after.focusIsInput, "shipped: focus stays in the input for the whole word").toBe(true);
  });

  it("a label edit still re-words every OTHER row's trigger picker + sentence LIVE (what the rebuild used to buy), with no rebuild", () => {
    const boot = bootGrid(GRID_CONTENT, "g1", slice("gridSyncTriggerLabels"));
    boot.run("renderGridQuestionsEditor(selectedNode())");
    const row1 = boot.root.querySelector('[data-grid-question-row="q1"]')!;
    const labelIn = row1.querySelector('[data-grid-q-field="label"]')!;
    const depRow = boot.root.querySelector('[data-grid-dep-row="q2"]')!;
    const whenSel = depRow.querySelector('[data-grid-dep="when"]')!;
    labelIn.value = "";
    labelIn.focus();
    typeInto(boot.doc, "Do you have insurance today?");
    // the SAME select object (never rebuilt) now reads the new words
    expect(whenSel.options.map((o) => o.textContent)).toEqual([
      "— always shown —",
      "Do you have insurance today?",
      "Credit Score",
      "Accidents in the last 3 years?",
    ]);
    expect(depRow.querySelector("[data-grid-dep-sentence]")!.textContent).toContain("Do you have insurance today?");
    expect(
      boot.root.querySelector('[data-grid-question-row="q2"]')!.querySelector('[data-grid-dep="when"]'),
      "the row objects are the ORIGINAL ones — nothing was torn down",
    ).toBe(whenSel);
  });
});

// =============================================================================
// BLOCKER 2 — an authored default becomes the visitor's answer
// =============================================================================

describe("R2 P1 FIX-FIRST · B2 — an authored dropdown/range default IS an answer", () => {
  it("the STUDIO write is canonical: every default kind stores props.defaultValue (range mirrors props.default for the slider renderers)", () => {
    const boot = bootGrid(GRID_CONTENT, "g1", "");
    boot.run("renderGridQuestionsEditor(selectedNode())");
    const defSel = boot.root
      .querySelector('[data-grid-question-row="q2"]')!
      .querySelector('[data-grid-q-field="default"]')!;
    defSel.value = "geico";
    defSel.fire("change");
    const q2 = boot.run("findRef('q2').node") as { props: Record<string, unknown> };
    expect(q2.props["defaultValue"], "dropdown → the canonical key").toBe("geico");
    expect(q2.props["default"], "the legacy key is not left disagreeing").toBeUndefined();
    // range: the answer key AND the render key
    boot.run("setGridQuestionType('q4', 'NumberRangeQuestion')");
    boot.run("setGridQuestionDefault(findRef('q4').node, '42')");
    const q4 = boot.run("findRef('q4').node") as { props: Record<string, unknown> };
    expect(q4.props["defaultValue"]).toBe(42);
    expect(q4.props["default"], "presets.ts renderRange reads ONLY props.default").toBe(42);
    // clearing removes BOTH — no resurrected default through the legacy key
    boot.run("setGridQuestionDefault(findRef('q4').node, '')");
    const cleared = boot.run("findRef('q4').node") as { props?: Record<string, unknown> };
    expect(cleared.props?.["defaultValue"]).toBeUndefined();
    expect(cleared.props?.["default"]).toBeUndefined();
  });

  it("the /lg/config projection carries default_answer for a UI-written node AND for a legacy props.default node", () => {
    const uiWritten = {
      type: "DropdownQuestion",
      question_id: "d1",
      internal_field: "current_insurer",
      answer_type: "enum",
      choices: [{ label: "Geico", value: "geico", analytics_id: "geico" }],
      props: { label: "Insurer", defaultValue: "geico" },
    } as unknown as LeadgenComponentNode;
    const legacy = {
      type: "DropdownQuestion",
      question_id: "d2",
      internal_field: "prior_insurer",
      answer_type: "enum",
      choices: [{ label: "Geico", value: "geico", analytics_id: "geico" }],
      props: { label: "Insurer", default: "geico" },
    } as unknown as LeadgenComponentNode;
    expect(toPublicComponent(uiWritten).default_answer).toEqual({ value: "geico", answer_source: "default_applied" });
    expect(toPublicComponent(legacy).default_answer).toEqual({ value: "geico", answer_source: "default_applied" });
    // …and through the GRID's own child projection, the shape /lg/config ships
    const grid = {
      type: LEADGEN_QUESTION_GRID_TYPE,
      question_id: "g9",
      props: {},
      children: [uiWritten, legacy],
    } as unknown as LeadgenComponentNode;
    const projected = projectSectionComponents([grid]);
    expect(projected[0]!.children!.map((c) => c.default_answer?.value)).toEqual(["geico", "geico"]);
  });

  it("BEHAVIORAL: the owner's pinned Q2 — Yes on the trigger, the dropdown UNTOUCHED — is answered by its default and no longer blocks Continue", () => {
    const content = JSON.parse(JSON.stringify(GRID_CONTENT)) as unknown as LeadgenSectionContent;
    const q2 = (content.components[0] as unknown as { children: Array<{ props: Record<string, unknown> }> }).children[1]!;
    q2.props["defaultValue"] = "geico";
    const { answers, sources } = normalizeAnswers(content, { currently_insured: true });
    expect(answers["current_insurer"], "the authored default IS his answer").toBe("geico");
    expect(sources["current_insurer"]).toBe("default_applied");
    const state = evaluateDependencies(content.components, answers);
    expect(state.blocking_question_ids, "the required rule is met — nothing blocks").toEqual([]);
    expect(state.continue_blocked).toBe(false);
    expect(validateSectionContent(content).errors).toEqual([]);
  });
});

// =============================================================================
// BLOCKER 3 — a hidden question "doesn't exist"
// =============================================================================

describe("R2 P1 FIX-FIRST · B3 — a dependency-HIDDEN question's default never reaches the wire", () => {
  // BOTH default keys are exercised on BOTH shapes. `default` is the key the
  // studio WROTE pre-fix (and the key the reviewer's live node carried, the one
  // whose value the server put into leadgen_provider_request_log); defaultValue
  // is what it writes now. The gate may not care which key spelled the default.
  const GRID_WITH_DEFAULT = (key: string) => (): LeadgenSectionContent => {
    const content = JSON.parse(JSON.stringify(GRID_CONTENT)) as unknown as LeadgenSectionContent;
    const q2 = (content.components[0] as unknown as { children: Array<{ props: Record<string, unknown> }> }).children[1]!;
    q2.props[key] = "geico";
    return content;
  };
  // The same shape WITHOUT the grid container — flat sections reproduce the
  // identical defect, so both walk the same gate.
  const FLAT_WITH_DEFAULT = (key: string) => (): LeadgenSectionContent =>
    ({
      components: [
        {
          type: "TwoButtonYesNo",
          question_id: "f1",
          internal_field: "currently_insured",
          answer_type: "boolean",
          props: { label: "Are you currently insured?" },
        },
        {
          type: "DropdownQuestion",
          question_id: "f2",
          internal_field: "current_insurer",
          answer_type: "enum",
          required: true,
          choices: [{ label: "Geico", value: "geico", analytics_id: "geico" }],
          props: { label: "Who is your current insurer?", [key]: "geico" },
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
      ],
    }) as unknown as LeadgenSectionContent;

  for (const [shape, build] of [
    ["grid · props.default (the pre-fix studio write)", GRID_WITH_DEFAULT("default")],
    ["grid · props.defaultValue (the canonical write)", GRID_WITH_DEFAULT("defaultValue")],
    ["flat · props.default (the pre-fix studio write)", FLAT_WITH_DEFAULT("default")],
    ["flat · props.defaultValue (the canonical write)", FLAT_WITH_DEFAULT("defaultValue")],
  ] as Array<[string, () => LeadgenSectionContent]>) {
    it(`${shape}: trigger NO → the hidden question contributes NOTHING (no answer, no source, no payload node)`, () => {
      const content = build();
      // the envelope the client really posts: it OMITS the hidden field
      const { answers, sources } = normalizeAnswers(content, { currently_insured: false });
      expect(answers["current_insurer"], "it doesn't exist — the server may not invent it").toBeUndefined();
      expect(sources["current_insurer"]).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(answers, "current_insurer")).toBe(false);
      // and therefore nothing reaches the Offer payload / provider request log
      const { payload } = generateOfferPayload(content, { currently_insured: false }, [
        {
          internal_field: "current_insurer",
          offer_payload_field_path: "insurance.carrier",
          provider_expected_type: "string",
        },
      ]);
      expect(payload).toEqual({});
    });

    it(`${shape}: trigger YES → the very same default DOES apply (the gate only removes what the visitor never saw)`, () => {
      const content = build();
      const { answers, sources } = normalizeAnswers(content, { currently_insured: true });
      expect(answers["current_insurer"]).toBe("geico");
      expect(sources["current_insurer"]).toBe("default_applied");
      const { payload } = generateOfferPayload(content, { currently_insured: true }, [
        {
          internal_field: "current_insurer",
          offer_payload_field_path: "insurance.carrier",
          provider_expected_type: "string",
        },
      ]);
      expect(payload).toEqual({ insurance: { carrier: "geico" } });
    });
  }

  it("a default that is UNCONDITIONAL still applies (no regression to the §12.6 default_applied path)", () => {
    const content = {
      components: [
        {
          type: "TwoButtonYesNo",
          question_id: "u1",
          internal_field: "currently_insured",
          answer_type: "boolean",
          props: { label: "Insured?", default: false },
        },
      ],
    } as unknown as LeadgenSectionContent;
    const { answers, sources } = normalizeAnswers(content, {});
    expect(answers["currently_insured"]).toBe(false);
    expect(sources["currently_insured"]).toBe("default_applied");
  });

  it("a chain resolves order-independently: a defaulted trigger reveals a dependent whose OWN default then applies", () => {
    const content = {
      components: [
        {
          // authored AFTER its trigger's dependent on purpose — the result may
          // not depend on authoring order
          type: "DropdownQuestion",
          question_id: "c2",
          internal_field: "insurer_tier",
          answer_type: "enum",
          choices: [{ label: "Gold", value: "gold", analytics_id: "gold" }],
          props: { label: "Tier", defaultValue: "gold" },
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
        {
          type: "TwoButtonYesNo",
          question_id: "c1",
          internal_field: "currently_insured",
          answer_type: "boolean",
          props: { label: "Insured?", defaultValue: true },
        },
      ],
    } as unknown as LeadgenSectionContent;
    const { answers, sources } = normalizeAnswers(content, {});
    expect(answers["currently_insured"]).toBe(true);
    expect(answers["insurer_tier"], "his default answer legitimately reveals the dependent").toBe("gold");
    expect(sources["insurer_tier"]).toBe("default_applied");
  });

  it("a SUBMITTED answer is never dropped by the gate (the client owns what it sends)", () => {
    const content = FLAT_WITH_DEFAULT("defaultValue")();
    const { answers, sources } = normalizeAnswers(content, {
      currently_insured: false,
      current_insurer: "progressive",
    });
    expect(answers["current_insurer"]).toBe("progressive");
    expect(sources["current_insurer"]).toBe("user_selected");
  });
});

// =============================================================================
// MAJOR 1 (DEC-D4) — per-question FREE COLOR
// =============================================================================

describe("R2 P1 FIX-FIRST · D4 — the per-question Style panel offers free colors, not roles only", () => {
  it("SSR: every color-typed override row carries the free-color input beside its role select", () => {
    for (const key of ["buttonBackground", "iconColor", "featureColor", "rangeColor"]) {
      expect(INSPECTOR, `${key} free-color control`).toContain(`data-inspector-override-hex="${key}"`);
    }
    expect(INSPECTOR).toContain("Custom color &#8212; off theme");
    expect(INSPECTOR).toContain('placeholder="#RRGGBB"');
    // the control is a real input with an accessible name, next to the role select
    expect(INSPECTOR).toMatch(/data-inspector-override-hex="buttonBackground"[^>]*aria-label="[^"]+"/);
  });

  it("EXECUTED: typing a hex writes it to the SAME design_overrides key; clearing restores the inherited role; a malformed value is never committed", () => {
    const { doc, root } = makeDoc();
    const input = doc.createElement("input");
    input.setAttribute("data-inspector-override-hex", "buttonBackground");
    root.appendChild(input);
    const sandbox: Record<string, unknown> = {
      document: doc,
      studioMeta: { max_depth: 4, types: META },
      state: {
        content: {
          components: [
            { type: "ButtonAnswerGroup", question_id: "b1", internal_field: "credit_score", props: { label: "Credit" } },
          ],
        },
      },
      selectedQuestionId: "b1",
      changes: 0,
    };
    runInNewContext(
      [
        "function afterModelChange() { changes += 1; }",
        ...["trimStr", "typeMeta", "isContainerType", "walkTree", "findRefIn", "findRef", "selectedNode", "ensureObj", "cleanupEmpty", "isHexColor"].map(slice),
        slice("collectInspectorOverrideHex"),
      ].join("\n"),
      sandbox,
    );
    const run = (expr: string): unknown => runInNewContext(expr, sandbox);
    input.value = "#FF5722";
    run("collectInspectorOverrideHex(document.querySelector('[data-inspector-override-hex]'))");
    expect(run("findRef('b1').node.design_overrides.buttonBackground")).toBe("#FF5722");
    input.value = "not-a-color";
    run("collectInspectorOverrideHex(document.querySelector('[data-inspector-override-hex]'))");
    expect(run("findRef('b1').node.design_overrides.buttonBackground"), "garbage never commits").toBe("#FF5722");
    input.value = "";
    run("collectInspectorOverrideHex(document.querySelector('[data-inspector-override-hex]'))");
    expect(run("findRef('b1').node.design_overrides"), "cleared back to inherited").toBeUndefined();
  });

  it("the free color survives the save gate and reaches the RENDERED question (per child, inside the grid)", () => {
    const content = {
      components: [
        {
          type: LEADGEN_QUESTION_GRID_TYPE,
          question_id: "g2",
          props: {},
          children: [
            {
              type: "ButtonAnswerGroup",
              question_id: "b1",
              internal_field: "credit_score",
              answer_type: "enum",
              choices: [{ label: "Excellent", value: "excellent", analytics_id: "exc" }],
              props: { label: "Credit Score" },
              design_overrides: { buttonBackground: "#FF5722" },
            },
          ],
        },
      ],
    } as unknown as LeadgenSectionContent;
    expect(validateSectionContent(content).errors, "a free hex is a valid stored override").toEqual([]);
    const html = renderSectionComponents(content.components as LeadgenComponentNode[], DESIGN);
    expect(html).toContain("#FF5722");
    // …and it is carried to the client config too (the same per-child projection)
    const projected = projectSectionComponents(content.components as LeadgenComponentNode[]);
    expect(projected[0]!.children![0]!.design_overrides).toEqual({ buttonBackground: "#FF5722" });
  });
});

// =============================================================================
// MINOR 1 — the quote rules rail speaks question words
// =============================================================================

describe("R2 P1 FIX-FIRST · M1 — the rules rail names a question by its own words", () => {
  function available(components: unknown[]): AvailableSection {
    return {
      id: 1,
      public_id: "lgs_rail",
      section_name: "Review",
      activity: "auto",
      vertical: "insurance",
      status: "active",
      content_json: { components } as never,
    } as AvailableSection;
  }

  it("each answer field carries the question's authored label (grid children included); a label-less question falls back to its field id", () => {
    const fields = quoteRailAnswerFields([
      available([
        {
          type: LEADGEN_QUESTION_GRID_TYPE,
          question_id: "g1",
          props: {},
          children: [
            { type: "ButtonAnswerGroup", question_id: "q1", internal_field: "rvw_credit_rvw7q3", props: { label: "Credit score" } },
            { type: "TwoButtonYesNo", question_id: "q2", internal_field: "rvw_insured_rvw7q3", props: {} },
          ],
        },
        { type: "ZIPInputQuestion", question_id: "q3", internal_field: "rvw_zip_rvw7q3", props: { label: "ZIP code" } },
      ]),
    ]);
    expect(fields.map((f) => f.label)).toEqual([
      "Review · Credit score",
      "Review · rvw_insured_rvw7q3",
      "Review · ZIP code",
    ]);
    // the STORED contract is still the field id (the rule writes that, not words)
    expect(fields.map((f) => f.internal_field)).toEqual([
      "rvw_credit_rvw7q3",
      "rvw_insured_rvw7q3",
      "rvw_zip_rvw7q3",
    ]);
  });
});
