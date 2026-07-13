// Section Builder v3.1 REMEDIATION — phase R1. DOM-lib runtime program half
// (mirrors test/leadgen-runtime-hydration.test.ts: the REAL LgEngine driven
// over a hand-rolled fake DOM — no DOM library, repo "no new deps" rule). Where
// the worker-program half (leadgen-r1-answers.test.ts) proves the recording
// HOOK exists in preset output, this half drives the engine's REAL delegated
// handlers to prove the hook actually reaches store.recordUserAnswer:
//   * Test A (iii): the select CHANGE path, the range INPUT path, the choice
//     CLICK path, the text INPUT path and the multi-select ARRAY path all
//     capture the value through the real handleInputEvent/handleChoiceActivation.
//   * E1-NEW-1 double-handling: a click whose target is the <select> (opening
//     it) records NOTHING via the choice delegate — the option-level
//     data-lg-choice attrs are inert for native selects; only `change` records.
//   * S2-3: a range `input` moves the visible .lg-range-value text +
//     .lg-range-fill width live (render.updateRangeDisplay) AND records.
//   * E1-NEW-4: a TwoButtonYesNo default_answer paints its yes/no button
//     selected on section entry (the dropped `component.choices !== undefined`
//     guard).
//
// TYPECHECK PROGRAM NOTE: imports the DOM-lib runtime modules (engine/render),
// so it type-checks under tsconfig.runtime.json (verify:leadgen-runtime) and is
// EXCLUDED from the worker tsconfig — the same split the hydration suite lives
// under (see the tsconfig include/exclude comments).

import { afterEach, describe, expect, it, vi } from "vitest";
import { LgEngine } from "../src/public/leadgen/runtime/engine";
import * as render from "../src/public/leadgen/runtime/render";
import type { LgComponentConfig, LgPublicConfig } from "../src/public/leadgen/runtime/state";

// ---------------------------------------------------------------------------
// Minimal fake DOM (only the surface the engine/render touch) — the same shape
// leadgen-runtime-hydration.test.ts proves boots the real engine.
// ---------------------------------------------------------------------------

function matchesSimple(el: FakeElement, raw: string): boolean {
  const sel = raw.trim();
  if (sel.startsWith(".")) return el.classSet.has(sel.slice(1));
  const m = sel.match(/^\[([^\]=]+)(?:="((?:[^"\\]|\\.)*)")?\]$/);
  if (m === null) return false;
  const name = m[1] ?? "";
  if (m[2] === undefined) return el.attrs.has(name);
  return el.getAttribute(name) === m[2].replace(/\\(.)/g, "$1");
}
function matchesSelector(el: FakeElement, selector: string): boolean {
  return selector.split(",").some((s) => matchesSimple(el, s));
}
function asEl(el: FakeElement): Element {
  return el as unknown as Element;
}

class FakeElement {
  tag: string;
  attrs = new Map<string, string>();
  classSet = new Set<string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = "";
  style: Record<string, string> = {};
  listeners = new Map<string, Array<(ev: unknown) => void>>();
  ownerDocument: FakeDocument | undefined;
  hidden = false;
  focusedCount = 0;

  constructor(tag = "div", attrs: Record<string, string> = {}) {
    this.tag = tag;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") for (const c of v.split(/\s+/)) { if (c !== "") this.classSet.add(c); }
      else this.attrs.set(k, v);
    }
  }
  get classList() {
    const set = this.classSet;
    return {
      add: (c: string) => void set.add(c),
      remove: (c: string) => void set.delete(c),
      contains: (c: string) => set.has(c),
      toggle: (c: string, on?: boolean) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)),
    };
  }
  get className(): string { return [...this.classSet].join(" "); }
  getAttribute(name: string): string | null {
    if (name === "class") return this.className;
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }
  setAttribute(name: string, value: string): void {
    if (name === "hidden") this.hidden = true;
    this.attrs.set(name, String(value));
  }
  removeAttribute(name: string): void {
    if (name === "hidden") this.hidden = false;
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  appendChild<T extends FakeElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  contains(el: FakeElement | null): boolean {
    let cur: FakeElement | null = el;
    while (cur !== null) { if (cur === this) return true; cur = cur.parentElement; }
    return false;
  }
  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this;
    while (cur !== null) { if (matchesSelector(cur, selector)) return cur; cur = cur.parentElement; }
    return null;
  }
  private descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => { for (const child of el.children) { out.push(child); walk(child); } };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeElement | null {
    return this.descendants().find((el) => matchesSelector(el, selector)) ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => matchesSelector(el, selector));
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatch(type: string, target: FakeElement): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ target });
  }
  focus(): void { this.focusedCount += 1; }
}

class FakeInputElement extends FakeElement {
  type = "text";
  value = "";
  checked = false;
  constructor(attrs: Record<string, string> = {}) { super("input", attrs); }
}

// A native <select> is NOT an HTMLInputElement — the engine's handleInputEvent
// must reach it through the `"value" in input` fallback, so this fake must NOT
// be stubbed as HTMLInputElement (only FakeInputElement is).
class FakeSelectElement extends FakeElement {
  value = "";
  constructor(attrs: Record<string, string> = {}) { super("select", attrs); }
}

interface FakeDocument {
  cookie: string;
  referrer: string;
  visibilityState: string;
  head: FakeElement;
  createElement(tag: string): FakeElement;
  querySelector(selector: string): FakeElement | null;
  getElementById(id: string): FakeElement | null;
  addEventListener(type: string, fn: unknown, opts?: unknown): void;
}
function fakeDocument(): FakeDocument {
  const doc: FakeDocument = {
    cookie: "", referrer: "", visibilityState: "visible", head: new FakeElement("head"),
    createElement(tag: string): FakeElement {
      const el = tag === "input" ? new FakeInputElement() : new FakeElement(tag);
      el.ownerDocument = doc;
      return el;
    },
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => undefined,
  };
  return doc;
}
function fakeSessionStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}
function stubBrowserGlobals(win: Record<string, unknown>, doc: FakeDocument): void {
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { href: "https://one.example.com/lg/fx", search: "" });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

// ---------------------------------------------------------------------------
// Engine harness — one section carrying every recording mechanism.
// ---------------------------------------------------------------------------

const COMPONENTS: LgComponentConfig[] = [
  { type: "DropdownQuestion", question_id: "q_dd", question_key: "k_dd", internal_field: "insurer", answer_type: "enum", props: {}, choices: [{ label: "A", value: "sole_prop", analytics_id: "a" }, { label: "B", value: "partnership", analytics_id: "b" }] },
  { type: "RangeQuestion", question_id: "q_rg", question_key: "k_rg", internal_field: "amt", answer_type: "number", props: {} },
  { type: "ButtonAnswerGroup", question_id: "q_bt", question_key: "k_bt", internal_field: "pick", answer_type: "enum", props: {}, choices: [{ label: "Yes", value: "yes", analytics_id: "ay" }, { label: "No", value: "no", analytics_id: "an" }] },
  { type: "FreeTextQuestion", question_id: "q_tx", question_key: "k_tx", internal_field: "note", props: {} },
  { type: "MultiChoiceCardGroup", question_id: "q_mc", question_key: "k_mc", internal_field: "features", answer_type: "array", props: {}, choices: [{ label: "X", value: "x", analytics_id: "ax" }, { label: "Y", value: "y", analytics_id: "ay" }] },
  { type: "TwoButtonYesNo", question_id: "q_yn", question_key: "k_yn", internal_field: "insured", answer_type: "boolean", props: {}, default_answer: { value: true, answer_source: "default_applied" } },
];

function engineConfig(): LgPublicConfig {
  return {
    quote_id: "lgq_1", funnel_id: "lgf_1", funnel_variant_id: "lgn_1", funnel_name: "F",
    content_version: 1, funnel_design_id: "default", design_tokens: {},
    section_order_hash: "hash_1", ga4_measurement_id: null,
    funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "",
    traffic_allocation_bp: 10000, assignment_reason: "single_control",
    sections: [{
      section_public_id: "lgs_1", section_index: 0, headline: "H",
      continue_mode: "button", address_validation_enabled: false,
      section_mapping_version: 0, answer_mapping_version: "0", components: COMPONENTS,
    }],
  };
}

interface Dom {
  root: FakeElement;
  dropdown: FakeSelectElement;
  rangeWrap: FakeElement;
  rangeInput: FakeInputElement;
  rangeValue: FakeElement;
  rangeFill: FakeElement;
  btnYes: FakeElement;
  textInput: FakeInputElement;
  mcX: FakeElement;
  mcY: FakeElement;
  ynYes: FakeElement;
  ynNo: FakeElement;
}

function buildDom(doc: FakeDocument, opts: { rangeCurrency?: boolean } = {}): Dom {
  const mk = (el: FakeElement): FakeElement => { el.ownerDocument = doc; return el; };
  const root = mk(new FakeElement("div", { id: "lg-funnel-root" })) as FakeElement;
  const mount = mk(new FakeElement("main", { "data-lg-mount": "" }));
  const section = mk(new FakeElement("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }));

  // Dropdown: the <select> IS the question element + the data-lg-input target.
  const dropdown = mk(new FakeSelectElement({ "data-lg-question": "q_dd", "data-lg-field": "insurer", "data-lg-input": "", class: "lg-input lg-dropdown" })) as FakeSelectElement;
  dropdown.appendChild(mk(new FakeElement("option", { "data-lg-choice": "sole_prop" })));
  dropdown.appendChild(mk(new FakeElement("option", { "data-lg-choice": "partnership" })));

  // Range: wrapper carries hydration; the input carries data-lg-input.
  const rangeWrap = mk(new FakeElement("div", { class: "lg-range", "data-format": opts.rangeCurrency ? "currency" : "number", "data-lg-question": "q_rg", "data-lg-field": "amt", ...(opts.rangeCurrency ? { "data-currency": "$" } : {}) }));
  const rangeValue = mk(new FakeElement("div", { class: "lg-range-value" }));
  rangeValue.textContent = opts.rangeCurrency ? "$0" : "0";
  const rangeTrack = mk(new FakeElement("div", { class: "lg-range-track" }));
  const rangeFill = mk(new FakeElement("div", { class: "lg-range-fill" }));
  rangeTrack.appendChild(rangeFill);
  const rangeInput = mk(new FakeInputElement({ "data-lg-input": "", min: "0", max: "100", step: "1", value: "0" })) as FakeInputElement;
  rangeInput.type = "range";
  rangeInput.value = "0";
  rangeWrap.appendChild(rangeValue);
  rangeWrap.appendChild(rangeTrack);
  rangeWrap.appendChild(rangeInput);

  // Button answer group (choice-click).
  const btnGroup = mk(new FakeElement("div", { "data-lg-question": "q_bt", "data-lg-field": "pick" }));
  const btnYes = mk(new FakeElement("button", { "data-lg-choice": "yes" }));
  btnGroup.appendChild(btnYes);
  btnGroup.appendChild(mk(new FakeElement("button", { "data-lg-choice": "no" })));

  // Text input (single element carries hydration + data-lg-input).
  const textInput = mk(new FakeInputElement({ "data-lg-question": "q_tx", "data-lg-field": "note", "data-lg-input": "" })) as FakeInputElement;

  // Multi-select (array).
  const mcGroup = mk(new FakeElement("div", { "data-lg-question": "q_mc", "data-lg-field": "features" }));
  const mcX = mk(new FakeElement("button", { "data-lg-choice": "x" }));
  const mcY = mk(new FakeElement("button", { "data-lg-choice": "y" }));
  mcGroup.appendChild(mcX);
  mcGroup.appendChild(mcY);

  // TwoButtonYesNo (default_answer true → paints ynYes selected on entry).
  const ynGroup = mk(new FakeElement("div", { "data-lg-question": "q_yn", "data-lg-field": "insured" }));
  const ynYes = mk(new FakeElement("button", { "data-lg-choice": "true" }));
  const ynNo = mk(new FakeElement("button", { "data-lg-choice": "false" }));
  ynGroup.appendChild(ynYes);
  ynGroup.appendChild(ynNo);

  for (const el of [dropdown, rangeWrap, btnGroup, textInput, mcGroup, ynGroup]) section.appendChild(el);
  mount.appendChild(section);
  root.appendChild(mount);
  return { root, dropdown, rangeWrap, rangeInput, rangeValue, rangeFill, btnYes, textInput, mcX, mcY, ynYes, ynNo };
}

async function boot(opts: { rangeCurrency?: boolean } = {}): Promise<{ dom: Dom; answers: () => Record<string, unknown> }> {
  const doc = fakeDocument();
  const win: Record<string, unknown> = { sessionStorage: fakeSessionStorage(), parent: { postMessage: () => undefined } };
  const dom = buildDom(doc, opts);
  stubBrowserGlobals(win, doc);
  // Preview mode + a 204 fetch stub → no real attempt/auction I/O.
  vi.stubGlobal("fetch", async (): Promise<Response> => new Response(null, { status: 204 }));
  const engine = new LgEngine(dom.root as unknown as HTMLElement, engineConfig(), true);
  await engine.init();
  const api = () => win["__LG_ENGINE__"] as { getAnswers: () => Record<string, unknown> };
  return { dom, answers: () => api().getAnswers() };
}

// ---------------------------------------------------------------------------
// Test A (iii) — the engine's REAL handlers capture each mechanism.
// ---------------------------------------------------------------------------

describe("R1 Test A(iii) — recordUserAnswer captures every mechanism through the real engine", () => {
  it("E1-NEW-1: a <select> `change` records the chosen value (data-lg-input path)", async () => {
    const { dom, answers } = await boot();
    dom.dropdown.value = "partnership";
    dom.root.dispatch("change", dom.dropdown);
    expect(answers()["insurer"]).toBe("partnership");
  });

  it("E1-NEW-1 double-handling: clicking the <select> itself (no data-lg-choice ancestor) records NOTHING via the choice delegate", async () => {
    const { dom, answers } = await boot();
    dom.root.dispatch("click", dom.dropdown); // opening the select
    expect(answers()["insurer"]).toBeUndefined();
    // …only `change` records — proving the option-level data-lg-choice attrs are
    // inert for the select (no double record).
    dom.dropdown.value = "sole_prop";
    dom.root.dispatch("change", dom.dropdown);
    expect(answers()["insurer"]).toBe("sole_prop");
  });

  it("S2-3: a range `input` records the dragged value AND moves the visible value + fill live", async () => {
    const { dom, answers } = await boot();
    dom.rangeInput.value = "75";
    dom.root.dispatch("input", dom.rangeInput);
    expect(answers()["amt"]).toBe("75");
    expect(dom.rangeValue.textContent).toBe("75"); // number format
    expect(dom.rangeFill.style["width"]).toBe("75%"); // (75-0)/100
    expect(dom.rangeInput.getAttribute("aria-valuenow")).toBe("75");
  });

  it("choice CLICK still records (no regression)", async () => {
    const { dom, answers } = await boot();
    dom.root.dispatch("click", dom.btnYes);
    expect(answers()["pick"]).toBe("yes");
  });

  it("text INPUT still records (no regression)", async () => {
    const { dom, answers } = await boot();
    dom.textInput.value = "hello";
    dom.root.dispatch("input", dom.textInput);
    expect(answers()["note"]).toBe("hello");
  });

  it("multi-select CLICK builds the array answer (E1-NEW-3 recording side)", async () => {
    const { dom, answers } = await boot();
    dom.root.dispatch("click", dom.mcX);
    dom.root.dispatch("click", dom.mcY);
    expect(answers()["features"]).toEqual(["x", "y"]);
  });
});

// ---------------------------------------------------------------------------
// S2-3 — render.updateRangeDisplay currency format (unit).
// ---------------------------------------------------------------------------

describe("R1 S2-3 — updateRangeDisplay rebuilds the value byte-identically to the server paint", () => {
  it("currency format: '$' prefix + en-US grouping + clamped fill %", async () => {
    const doc = fakeDocument();
    stubBrowserGlobals({ sessionStorage: fakeSessionStorage() }, doc);
    const dom = buildDom(doc, { rangeCurrency: true });
    dom.rangeInput.setAttribute("min", "10000");
    dom.rangeInput.setAttribute("max", "1000000");
    dom.rangeInput.value = "330000";
    render.updateRangeDisplay(dom.rangeInput as unknown as HTMLInputElement);
    expect(dom.rangeValue.textContent).toBe("$330,000");
    // (330000-10000)/(1000000-10000) ≈ 32.3% → round 32
    expect(dom.rangeFill.style["width"]).toBe("32%");
  });

  it("is a safe no-op when the input is not inside a .lg-range wrapper", async () => {
    const doc = fakeDocument();
    stubBrowserGlobals({ sessionStorage: fakeSessionStorage() }, doc);
    const orphan = new FakeInputElement({ min: "0", max: "100", value: "50" });
    orphan.type = "range";
    orphan.value = "50";
    expect(() => render.updateRangeDisplay(orphan as unknown as HTMLInputElement)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// E1-NEW-4 — TwoButtonYesNo default renders selected on section entry.
// ---------------------------------------------------------------------------

describe("R1 E1-NEW-4 — a TwoButtonYesNo default paints its button selected on entry", () => {
  it("default_answer true → the 'true' button carries lg-selected after init (guard drop)", async () => {
    const { dom, answers } = await boot();
    // the default was applied to state…
    expect(answers()["insured"]).toBe(true);
    // …AND painted onto the yes/no button (the register E1-NEW-4 defect: the old
    // `component.choices !== undefined` guard skipped this — choices is never
    // projected for TwoButtonYesNo).
    expect(dom.ynYes.classSet.has(render.SELECTED_CLASS)).toBe(true);
    expect(dom.ynYes.getAttribute("aria-pressed")).toBe("true");
    expect(dom.ynNo.classSet.has(render.SELECTED_CLASS)).toBe(false);
  });
});
