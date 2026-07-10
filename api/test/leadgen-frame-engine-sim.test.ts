// LeadGen v2.5.1 Phase A — ENGINE-SIM coverage for the frame-level progress +
// back mounts (11 §11.6 engine-audit leg): the REAL LgEngine driven over a
// fake DOM shaped exactly like renderProgressRegion/renderBackRegion output
// (designs/frame.ts), so frame-owned chrome behavior is proven at unit level:
//
//   (a) dots-style progress mount (the REGION WRAPPER carries data-lg-progress
//       data-mode="step"; the StepIndicator dots ride inside): after an engine
//       advance to step 2 the wrapper stamps aria-valuenow="2" AND exactly one
//       .lg-step is active — the 2nd (render.ts updateProgress re-stamps dots);
//   (b) frame-level back mount: hidden at init (empty back_stack), visible
//       after one advance — setBackVisible scoped to the funnel ROOT (§11.6);
//   (c) back mount with data-history-fallback="true" + a same-origin referrer
//       (11 §11.2): visible at init DESPITE the empty stack, and a back
//       activation on the empty stack walks browser history — history.back()
//       exactly once, section pointer unmoved.
//
// Harness: the FakeElement pattern from test/leadgen-runtime-hydration.test.ts
// (fake DOM stubbed onto the globals; no DOM library — repo constraint).

// TYPECHECK PROGRAM NOTE: this file imports the DOM-lib runtime modules
// (engine/render), so it belongs to tsconfig.runtime.json (lib DOM, checked
// by verify:leadgen-runtime) and is EXCLUDED from the worker tsconfig —
// exactly the leadgen-runtime-hydration.test.ts split.

import { afterEach, describe, expect, it, vi } from "vitest";

import { LgEngine } from "../src/public/leadgen/runtime/engine";
import type { LgComponentConfig, LgPublicConfig } from "../src/public/leadgen/runtime/state";

// ---------------------------------------------------------------------------
// Minimal fake DOM (only the surface the runtime modules touch)
// ---------------------------------------------------------------------------

// Selector grammar actually used by the runtime modules: `[attr]`,
// `[attr="value"]` (with \-escapes), `.class` — optionally comma-separated.
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
  focusedCount = 0;

  constructor(tag = "div", attrs: Record<string, string> = {}) {
    this.tag = tag;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") {
        for (const c of v.split(/\s+/)) if (c !== "") this.classSet.add(c);
      } else {
        this.attrs.set(k, v);
      }
    }
  }

  get classList(): { add(c: string): void; remove(c: string): void; contains(c: string): boolean } {
    const set = this.classSet;
    return {
      add: (c: string) => void set.add(c),
      remove: (c: string) => void set.delete(c),
      contains: (c: string) => set.has(c),
    };
  }

  getAttribute(name: string): string | null {
    if (name === "class") return [...this.classSet].join(" ");
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(el: FakeElement | null): boolean {
    let cur: FakeElement | null = el;
    while (cur !== null) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this;
    while (cur !== null) {
      if (matchesSelector(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  private descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const child of el.children) {
        out.push(child);
        walk(child);
      }
    };
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

  focus(): void {
    this.focusedCount += 1;
  }
}

class FakeInputElement extends FakeElement {
  type = "text";
  value = "";
  checked = false;
  constructor(attrs: Record<string, string> = {}) {
    super("input", attrs);
  }
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
    cookie: "",
    referrer: "",
    visibilityState: "visible",
    head: new FakeElement("head"),
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

function fakeSessionStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
} {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const ORIGIN = "https://one.example.com";

// Stub the browser globals the engine consumes. Unlike the hydration file's
// stub, `location` carries `origin` (sameOriginReferrer compares against it —
// the §11.2 leg under test here).
function stubBrowserGlobals(win: Record<string, unknown>, doc: FakeDocument): void {
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", {
    href: `${ORIGIN}/lg/sim?utm_source=sim`,
    search: "?utm_source=sim",
    origin: ORIGIN,
  });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 3-section engine config + a frame-shaped fake DOM
// ---------------------------------------------------------------------------

const SECTION_IDS = ["lgs_1", "lgs_2", "lgs_3"] as const;

function sectionComponent(i: number): LgComponentConfig {
  return {
    type: "TwoButtonYesNo",
    question_id: `q${i}`,
    question_key: `k${i}`,
    internal_field: `f${i}`,
    props: {},
    choices: [
      { label: "Yes", value: "yes", analytics_id: `a_yes_${i}` },
      { label: "No", value: "no", analytics_id: `a_no_${i}` },
    ],
  };
}

function engineConfig(): LgPublicConfig {
  return {
    quote_id: "lgq_1",
    funnel_id: "lgf_1",
    funnel_variant_id: "lgn_1",
    funnel_name: "F",
    content_version: 1,
    funnel_design_id: "default",
    design_tokens: {},
    section_order_hash: "hash_1",
    ga4_measurement_id: null,
    funnel_ab_test_id: "",
    funnel_ab_test_revision: 0,
    variant_label: "",
    traffic_allocation_bp: 10000,
    assignment_reason: "single_control",
    sections: SECTION_IDS.map((id, i) => ({
      section_public_id: id,
      section_index: i,
      headline: `H${i + 1}`,
      continue_mode: "button" as const,
      address_validation_enabled: false,
      section_mapping_version: 0,
      answer_mapping_version: "0",
      components: [sectionComponent(i)],
    })),
  };
}

interface FrameDom {
  root: FakeElement;
  progressMount: FakeElement;
  dots: FakeElement[];
  backMount: FakeElement;
  backButton: FakeElement;
  continues: FakeElement[];
}

// Mirrors the composed-frame output (designs/frame.ts): the dots-style
// progress REGION WRAPPER itself carries the engine mount hook
// (data-lg-progress data-mode="step") with the StepIndicator dots + hidden
// label sink inside; the back region wrapper carries data-history-fallback and
// the BackButton preset's [data-lg-back] hook inside; sections ride inside the
// section_slot's [data-lg-mount]. All FRAME-level chrome sits OUTSIDE the
// swapped [data-lg-section] elements.
function buildFrameDom(doc: FakeDocument, opts: { historyFallback: "true" | "false" }): FrameDom {
  const root = new FakeElement("div", { id: "lg-funnel-root" });

  // Frame progress region (dots style): wrapper = engine mount.
  const progressMount = new FakeElement("div", {
    class: "lg-frame-region lg-frame-progress lg-frame-progress--dots",
    "data-frame-region": "progress",
    "data-lg-progress": "",
    "data-mode": "step",
  });
  const steps = new FakeElement("div", {
    class: "lg-steps",
    role: "progressbar",
    "aria-valuemin": "1",
    "aria-valuemax": "3",
    "aria-valuenow": "1",
  });
  const dots: FakeElement[] = [];
  for (let i = 0; i < 3; i++) {
    const dot = new FakeElement(
      "span",
      i === 0
        ? { class: "lg-step", "data-active": "true", "aria-hidden": "true" }
        : { class: "lg-step", "aria-hidden": "true" },
    );
    dots.push(dot);
    steps.appendChild(dot);
  }
  const labelSink = new FakeElement("span", {
    class: "lg-frame-progress-label",
    "data-lg-progress-label": "",
    hidden: "",
  });
  progressMount.appendChild(steps);
  progressMount.appendChild(labelSink);
  root.appendChild(progressMount);

  // Frame back region: wrapper carries data-history-fallback; the BackButton
  // preset's [data-lg-back] button rides inside, initially visible (initial
  // visibility is engine-owned — renderBackRegion contract).
  const backMount = new FakeElement("div", {
    class: "lg-frame-region lg-frame-back",
    "data-frame-region": "back",
    "data-history-fallback": opts.historyFallback,
  });
  const backButton = new FakeElement("button", { class: "lg-back", "data-lg-back": "" });
  backMount.appendChild(backButton);
  root.appendChild(backMount);

  // section_slot mount with the 3 swapped sections.
  const mount = new FakeElement("main", { "data-lg-mount": "" });
  const continues: FakeElement[] = [];
  SECTION_IDS.forEach((id, i) => {
    const sectionEl = new FakeElement("section", {
      "data-lg-section": "",
      "data-lg-section-id": id,
      "data-lg-index": String(i),
      ...(i > 0 ? { hidden: "" } : {}),
    });
    const cont = new FakeElement("button", { "data-lg-continue": "" });
    continues.push(cont);
    sectionEl.appendChild(cont);
    mount.appendChild(sectionEl);
  });
  root.appendChild(mount);

  const setOwner = (el: FakeElement): void => {
    el.ownerDocument = doc;
    for (const child of el.children) setOwner(child);
  };
  setOwner(root);
  return { root, progressMount, dots, backMount, backButton, continues };
}

interface SimHarness extends FrameDom {
  win: Record<string, unknown>;
  doc: FakeDocument;
  engineApi: () => {
    getState: () => { section_index: number; back_stack: number[] };
  };
}

async function bootFrameEngine(opts: {
  preview: boolean;
  historyFallback: "true" | "false";
  referrer?: string;
  fetchMock?: (url: string) => Response | null;
}): Promise<SimHarness> {
  const doc = fakeDocument();
  if (opts.referrer !== undefined) doc.referrer = opts.referrer;
  const win: Record<string, unknown> = {
    sessionStorage: fakeSessionStorage(),
    parent: { postMessage: () => undefined }, // preview beacon sink
  };
  const dom = buildFrameDom(doc, { historyFallback: opts.historyFallback });
  stubBrowserGlobals(win, doc);
  if (opts.fetchMock !== undefined) {
    const mock = opts.fetchMock;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      return mock(url) ?? new Response(null, { status: 204 });
    });
  }

  const engine = new LgEngine(dom.root as unknown as HTMLElement, engineConfig(), opts.preview);
  await engine.init();

  return {
    win,
    doc,
    ...dom,
    engineApi: () =>
      win["__LG_ENGINE__"] as {
        getState: () => { section_index: number; back_stack: number[] };
      },
  };
}

function activeDotIndexes(dots: readonly FakeElement[]): number[] {
  return dots.flatMap((dot, i) => (dot.getAttribute("data-active") === "true" ? [i] : []));
}

// ---------------------------------------------------------------------------
// (a) frame-level dots mount — the dots ADVANCE with the engine
// ---------------------------------------------------------------------------

describe("frame dots progress mount (11 §11.6 — updateProgress re-stamps .lg-step)", () => {
  it("after an engine advance to step 2: wrapper aria-valuenow=2 AND exactly one active dot — the 2nd", async () => {
    vi.useFakeTimers();
    const h = await bootFrameEngine({ preview: true, historyFallback: "false" });

    // Init lands on step 1 of 3 — the wrapper is stamped, dot 1 stays the
    // single active dot (server-rendered state confirmed, not wiped).
    expect(h.progressMount.getAttribute("aria-valuenow")).toBe("1");
    expect(h.progressMount.getAttribute("aria-valuemax")).toBe("3");
    expect(activeDotIndexes(h.dots)).toEqual([0]);
    // The dots survive hydration (never textContent-wiped): 3 children intact.
    expect(h.progressMount.children[0]!.children.length).toBe(3);

    // Engine advance: continue on section 1 → section 2 (step 2 of 3).
    h.root.dispatch("click", h.continues[0]!);
    expect(h.engineApi().getState().section_index).toBe(1);

    expect(h.progressMount.getAttribute("aria-valuenow")).toBe("2");
    expect(h.progressMount.getAttribute("data-lg-progress-current")).toBe("2");
    // EXACTLY one active dot, and it is the 2nd (index 1).
    expect(activeDotIndexes(h.dots)).toEqual([1]);
    // The hidden label sink absorbed the step text (dots untouched by text).
    expect(h.progressMount.querySelector("[data-lg-progress-label]")!.textContent).toBe("2 / 3");
  });
});

// ---------------------------------------------------------------------------
// (b) frame-level back mount — engine-owned visibility over the ROOT scope
// ---------------------------------------------------------------------------

describe("frame back mount (11 §11.6 — setBackVisible scoped to the funnel root)", () => {
  it("hidden at init (empty back_stack), visible after one advance", async () => {
    vi.useFakeTimers();
    const h = await bootFrameEngine({ preview: true, historyFallback: "false" });

    // Init: empty back_stack + no armed fallback → the frame-level
    // [data-lg-back] (OUTSIDE the swapped sections) is hidden by the engine.
    expect(h.engineApi().getState().back_stack).toEqual([]);
    expect(h.backButton.hasAttribute("hidden")).toBe(true);

    // One advance → back_stack non-empty → the same mount becomes visible.
    h.root.dispatch("click", h.continues[0]!);
    expect(h.engineApi().getState().back_stack).toEqual([0]);
    expect(h.backButton.hasAttribute("hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) history fallback (11 §11.2) — armed back mount on an empty stack
// ---------------------------------------------------------------------------

describe("frame back mount with data-history-fallback (11 §11.2)", () => {
  it('data-history-fallback="true" + same-origin referrer: visible at init; back on empty stack calls history.back() exactly once', async () => {
    vi.useFakeTimers();
    const backSpy = vi.fn();
    vi.stubGlobal("history", { back: backSpy });

    const h = await bootFrameEngine({
      preview: false, // the fallback never arms in the Studio preview iframe
      historyFallback: "true",
      referrer: `${ORIGIN}/previous-page`, // same-origin → arms the fallback
      fetchMock: (url) => {
        if (url.includes("/lg/attempt")) {
          return new Response(
            JSON.stringify({ funnel_attempt_id: "att_SIM00001", signed_config_token: "v2.p.s" }),
            { status: 200 },
          );
        }
        return null; // /lg/track etc → 204
      },
    });

    // Armed fallback keeps the affordance VISIBLE on the empty stack.
    expect(h.engineApi().getState().back_stack).toEqual([]);
    expect(h.backButton.hasAttribute("hidden")).toBe(false);

    // Back activation on the EMPTY stack walks browser history — exactly
    // once — and never moves the section pointer.
    h.root.dispatch("click", h.backButton);
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(h.engineApi().getState().section_index).toBe(0);
    expect(h.backButton.hasAttribute("hidden")).toBe(false);
  });
});
