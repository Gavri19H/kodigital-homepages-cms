// LeadGen Rework — P2 S2.3 runtime widget behavior over the REAL LgEngine
// driven through real DOM events on a hand-rolled fake DOM (mirrors
// test/leadgen-r1-runtime-recording.test.ts / leadgen-runtime-hydration.test.ts
// — the repo "no new deps" rule forbids jsdom). Every behavior below is proven
// through the engine's delegated click/input/change/keydown handlers — never a
// direct store mutation.
//
// Coverage (contract anchors):
//   * §6.9 phone mask fill — scaffold fill, caret-at-first-empty-slot, Backspace
//     drops the last digit, paste/autofill filter to digits, incomplete blocks
//     Continue with the author's message (A-7), complete passes, RAW digits
//     recorded.
//   * §6.8 sliders — stepper steps by its required step; from_to/dual record
//     {base}_min/{base}_max; role=slider + aria-valuenow live on every handle;
//     from_to bounds (min ≤ from ≤ to ≤ max) + both-required.
//   * §6.5 Other-select — picking an Other value records it + deselects base;
//     picking a base clears the Other select (both directions).
//   * §6.10 Address — per-field required + none/zip5/{regex,message}; a field
//     kind not authored is never validated.
//   * §4.3-11 progress recomputes after a funnel switch; §4.3-12 auction fires
//     only past the LAST page, never the shared page alone.
//   * §4.2 invariants on the new widgets — default provenance, and a
//     dependency-hidden required component is not required + not persisted.
//
// TYPECHECK PROGRAM NOTE: imports the DOM-lib runtime modules (engine/render/
// state/validation), so it belongs to tsconfig.runtime.json (verify:leadgen-
// runtime) and must be EXCLUDED from the worker tsconfig — the SAME split the
// hydration / r1 / frame-engine-sim suites live under. (Wiring both tsconfigs
// is outside slice S2.3's owned files — see the S2.3 report.)

import { afterEach, describe, expect, it, vi } from "vitest";
import { LgEngine } from "../src/public/leadgen/runtime/engine";
import type {
  LgComponentConfig,
  LgPublicConfig,
  LgSectionConfig,
} from "../src/public/leadgen/runtime/state";

// ---------------------------------------------------------------------------
// Fake DOM (only the surface the engine/render touch) — the r1 harness plus
// selectionStart/setSelectionRange (mask caret) and an event-extra dispatch
// (keydown key/preventDefault).
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
  // Support a two-token descendant selector "[a] [b]" (used by the Other-panel
  // lookup: "[data-lg-other-panel] [data-lg-input]") — the second token is
  // matched against the element, the first against any ancestor.
  const parts = selector.trim().split(/\s+(?![^[]*\])/);
  if (parts.length === 2) {
    if (!matchesSimple(el, parts[1] ?? "")) return false;
    let cur = el.parentElement;
    while (cur !== null) {
      if (matchesSimple(cur, parts[0] ?? "")) return true;
      cur = cur.parentElement;
    }
    return false;
  }
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
      toggle: (c: string, on?: boolean) =>
        on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c),
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
  // r1 passes {target}; this variant merges event extras (keydown key /
  // preventDefault) so the masked-phone Backspace handler is exercised.
  dispatch(type: string, target: FakeElement, extra: Record<string, unknown> = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ target, ...extra });
  }
  focus(): void { this.focusedCount += 1; }
}

class FakeInputElement extends FakeElement {
  type = "text";
  value = "";
  checked = false;
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  constructor(attrs: Record<string, string> = {}) { super("input", attrs); }
  // The mask fill parks the caret via setSelectionRange (§6.9) — the fake mirrors
  // the real HTMLInputElement API so the caret assertion exercises the real path.
  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}
// A native <select> is not an HTMLInputElement — reached via the `"value" in
// input` fallback in handleInputEvent (Other-select change path).
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
// Shared builders
// ---------------------------------------------------------------------------

let DOC: FakeDocument;
function mk(tag: string, attrs: Record<string, string> = {}, kids: FakeElement[] = []): FakeElement {
  const el = tag === "input" ? new FakeInputElement(attrs) : tag === "select" ? new FakeSelectElement(attrs) : new FakeElement(tag, attrs);
  el.ownerDocument = DOC;
  for (const k of kids) el.appendChild(k);
  return el;
}

function baseConfig(sections: LgSectionConfig[]): LgPublicConfig {
  return {
    quote_id: "lgq_1", funnel_id: "lgf_1", funnel_variant_id: "lgn_1", funnel_name: "F",
    content_version: 1, funnel_design_id: "default", design_tokens: {},
    section_order_hash: "hash_1", ga4_measurement_id: null,
    funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "",
    traffic_allocation_bp: 10000, assignment_reason: "single_control",
    sections,
  };
}
function section(id: string, index: number, components: LgComponentConfig[]): LgSectionConfig {
  return {
    section_public_id: id, section_index: index, headline: "H",
    continue_mode: "button", address_validation_enabled: false,
    section_mapping_version: 0, answer_mapping_version: "0", components,
  };
}

type FetchMock = (url: string, body: string | undefined) => { status?: number; json?: unknown };

async function boot(
  config: LgPublicConfig,
  root: FakeElement,
  opts: { preview?: boolean; fetchMock?: FetchMock } = {},
): Promise<{ root: FakeElement; win: Record<string, unknown>; answers: () => Record<string, unknown>; state: () => { section_index: number; auction: { status: string } }; snapshot: () => Record<string, { value: unknown; answer_source: string }> | null }> {
  const win: Record<string, unknown> = { sessionStorage: fakeSessionStorage(), parent: { postMessage: () => undefined } };
  stubBrowserGlobals(win, root.ownerDocument as FakeDocument);
  const calls: Array<{ url: string; body: string | undefined }> = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const u = String(url);
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url: u, body });
    if (opts.fetchMock !== undefined) {
      const r = opts.fetchMock(u, body);
      return new Response(r.json !== undefined ? JSON.stringify(r.json) : null, { status: r.status ?? 200 });
    }
    return new Response(null, { status: 204 });
  });
  (win as { __lgCalls?: unknown }).__lgCalls = calls;
  const engine = new LgEngine(root as unknown as HTMLElement, config, opts.preview ?? false);
  await engine.init();
  const api = () => win["__LG_ENGINE__"] as {
    getAnswers: () => Record<string, unknown>;
    getState: () => { section_index: number; auction: { status: string } };
  };
  const snapshot = (): Record<string, { value: unknown; answer_source: string }> | null => {
    const ss = win["sessionStorage"] as ReturnType<typeof fakeSessionStorage>;
    for (let i = 0; i < ss.length; i++) {
      const k = ss.key(i);
      if (k !== null && k.startsWith("lg:")) {
        const parsed = JSON.parse(ss.getItem(k) as string) as { answers: Record<string, { value: unknown; answer_source: string }> };
        return parsed.answers;
      }
    }
    return null;
  };
  return { root, win, answers: () => api().getAnswers(), state: () => api().getState(), snapshot };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// §6.9 — phone mask fill UX
// ---------------------------------------------------------------------------

const MASK_CV = {
  required: true,
  phone: { regex: "^\\d{10}$", normalize: "digits", message: "Enter a complete phone number.", scaffold: "(___) ___-____", digit_count: 10 },
};

function maskDom(): { root: FakeElement; input: FakeInputElement; cont: FakeElement; err: FakeElement } {
  DOC = fakeDocument();
  const input = mk("input", { "data-lg-input": "", type: "tel" }) as FakeInputElement;
  input.type = "tel";
  const err = mk("p", { "data-lg-error-for": "phone" });
  const question = mk("div", { "data-lg-question": "q_ph", "data-lg-field": "phone" }, [input, err]);
  const cont = mk("button", { "data-lg-continue": "" });
  const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [question, cont]);
  const mount = mk("main", { "data-lg-mount": "" }, [sec]);
  const root = mk("div", { id: "lg-funnel-root" }, [mount]);
  return { root, input, cont, err };
}
function maskConfig(): LgPublicConfig {
  return baseConfig([section("lgs_1", 0, [
    { type: "PhoneInputQuestion", question_id: "q_ph", question_key: "k_ph", internal_field: "phone", required: true, props: {}, client_validation: MASK_CV },
  ])]);
}
function typeChar(root: FakeElement, input: FakeInputElement, ch: string): void {
  const pos = input.selectionStart ?? input.value.length;
  input.value = input.value.slice(0, pos) + ch + input.value.slice(pos);
  input.selectionStart = input.selectionEnd = pos + 1;
  root.dispatch("input", input);
}

describe("§6.9 phone mask — fill UX + raw-digit recording through the real engine", () => {
  it("boot paints the EMPTY scaffold as the input value", async () => {
    const dom = maskDom();
    await boot(maskConfig(), dom.root, { preview: true });
    expect(dom.input.value).toBe("(___) ___-____");
  });

  it("typing 2,1,5 fills left-to-right → '(215) ___-____', caret at the first empty slot, raw digits recorded", async () => {
    const dom = maskDom();
    const { answers } = await boot(maskConfig(), dom.root, { preview: true });
    typeChar(dom.root, dom.input, "2");
    expect(dom.input.value).toBe("(2__) ___-____");
    expect(dom.input.selectionStart).toBe(2);
    typeChar(dom.root, dom.input, "1");
    typeChar(dom.root, dom.input, "5");
    expect(dom.input.value).toBe("(215) ___-____");
    expect(dom.input.selectionStart).toBe(6); // first "_" after "(215) "
    expect(answers()["phone"]).toBe("215"); // RAW digits, not the display
  });

  it("Backspace clears the LAST FILLED DIGIT (not the literal before the caret)", async () => {
    const dom = maskDom();
    const { answers } = await boot(maskConfig(), dom.root, { preview: true });
    for (const c of ["2", "1", "5"]) typeChar(dom.root, dom.input, c);
    expect(answers()["phone"]).toBe("215");
    dom.root.dispatch("keydown", dom.input, { key: "Backspace", preventDefault: () => undefined });
    expect(dom.input.value).toBe("(21_) ___-____");
    expect(answers()["phone"]).toBe("21");
  });

  it("paste with junk + separators filters to digits", async () => {
    const dom = maskDom();
    const { answers } = await boot(maskConfig(), dom.root, { preview: true });
    dom.input.value = "21x5-55"; // simulate a select-all paste
    dom.root.dispatch("input", dom.input);
    expect(answers()["phone"]).toBe("21555");
    expect(dom.input.value).toBe("(215) 55_-____");
  });

  it("browser autofill strips non-digits then fills", async () => {
    const dom = maskDom();
    const { answers } = await boot(maskConfig(), dom.root, { preview: true });
    dom.input.value = "215.555.1234"; // autofilled value
    dom.root.dispatch("input", dom.input);
    expect(answers()["phone"]).toBe("2155551234");
    expect(dom.input.value).toBe("(215) 555-1234");
  });

  it("incomplete BLOCKS Continue with the author's message (A-7); complete PASSES and records raw digits", async () => {
    const dom = maskDom();
    const { answers, state } = await boot(maskConfig(), dom.root, { preview: true });
    for (const c of ["2", "1", "5"]) typeChar(dom.root, dom.input, c); // 3 of 10
    dom.root.dispatch("click", dom.cont);
    expect(dom.err.textContent).toBe("Enter a complete phone number.");
    expect(dom.root.getAttribute("data-lg-complete")).toBeNull(); // no advance
    // Complete it → Continue passes → single-section funnel finalizes (preview).
    dom.input.value = "215.555.1234";
    dom.root.dispatch("input", dom.input);
    dom.root.dispatch("click", dom.cont);
    expect(answers()["phone"]).toBe("2155551234");
    expect(dom.root.getAttribute("data-lg-complete")).toBe("1");
    void state;
  });
});

// ---------------------------------------------------------------------------
// §6.8 — slider types
// ---------------------------------------------------------------------------

describe("§6.8 sliders — stepper / from_to / dual / aria / bounds through the real engine", () => {
  function sliderRoot(components: LgComponentConfig[], build: (sec: FakeElement) => void): FakeElement {
    DOC = fakeDocument();
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" });
    build(sec);
    sec.appendChild(mk("button", { "data-lg-continue": "" }));
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    void components;
    return root;
  }

  it("stepper: the ＋ button steps by the REQUIRED step, records, and syncs aria-valuenow", async () => {
    const comp: LgComponentConfig = { type: "NumberRangeQuestion", question_id: "q_st", internal_field: "qty", answer_type: "number", props: { slider_type: "stepper", min: 0, max: 20, step: 5 }, client_validation: { min: 0, max: 20, step: 5 } };
    let input!: FakeInputElement; let inc!: FakeElement;
    const root = sliderRoot([comp], (sec) => {
      input = mk("input", { "data-lg-input": "", type: "range", role: "slider", min: "0", max: "20", step: "5", value: "0", "aria-valuemin": "0", "aria-valuemax": "20", "aria-valuenow": "0" }) as FakeInputElement;
      input.type = "range"; input.value = "0";
      inc = mk("button", { "data-lg-step": "inc" });
      sec.appendChild(mk("div", { "data-lg-question": "q_st", "data-lg-field": "qty" }, [mk("div", { class: "lg-range" }, [input]), mk("button", { "data-lg-step": "dec" }), inc]));
    });
    const { answers } = await boot(baseConfig([section("lgs_1", 0, [comp])]), root, { preview: true });
    root.dispatch("click", inc);
    expect(input.value).toBe("5"); // 0 + step(5)
    expect(answers()["qty"]).toBe("5");
    expect(input.getAttribute("aria-valuenow")).toBe("5");
    root.dispatch("click", inc);
    expect(answers()["qty"]).toBe("10");
  });

  it("from_to: two role=slider inputs record {base}_min/{base}_max + sync aria; bounds block when from > to", async () => {
    const comp: LgComponentConfig = { type: "NumberRangeQuestion", question_id: "q_ft", internal_field: "budget", answer_type: "object", required: true, props: { slider_type: "from_to", min: 0, max: 100, step: 1 }, client_validation: { required: true, min: 0, max: 100, step: 1 } };
    let lo!: FakeInputElement; let hi!: FakeInputElement; let cont!: FakeElement; let errLo!: FakeElement;
    DOC = fakeDocument();
    lo = mk("input", { "data-lg-input": "", type: "number", role: "slider", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }) as FakeInputElement;
    hi = mk("input", { "data-lg-input": "", type: "number", role: "slider", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }) as FakeInputElement;
    errLo = mk("p", { "data-lg-error-for": "budget_min" });
    const q = mk("div", { "data-lg-question": "q_ft", "data-lg-field": "budget" }, [
      mk("div", { "data-lg-field": "budget_min" }, [lo]),
      mk("div", { "data-lg-field": "budget_max" }, [hi]),
      errLo, mk("p", { "data-lg-error-for": "budget_max" }),
    ]);
    cont = mk("button", { "data-lg-continue": "" });
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q, cont]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    const { answers, state } = await boot(baseConfig([section("lgs_1", 0, [comp])]), root, { preview: true });

    lo.value = "20"; root.dispatch("input", lo);
    hi.value = "80"; root.dispatch("input", hi);
    expect(answers()["budget_min"]).toBe("20");
    expect(answers()["budget_max"]).toBe("80");
    expect(lo.getAttribute("aria-valuenow")).toBe("20");
    expect(hi.getAttribute("aria-valuenow")).toBe("80");
    // valid (20 ≤ 80) → Continue advances (single-section preview → finalize)
    root.dispatch("click", cont);
    expect(state().section_index === 0 && root.getAttribute("data-lg-complete") === "1").toBe(true);
  });

  it("from_to: from > to blocks Continue with the ordering message", async () => {
    const comp: LgComponentConfig = { type: "NumberRangeQuestion", question_id: "q_ft", internal_field: "budget", answer_type: "object", required: true, props: { slider_type: "from_to", min: 0, max: 100 }, client_validation: { required: true, min: 0, max: 100 } };
    DOC = fakeDocument();
    const lo = mk("input", { "data-lg-input": "", type: "number", role: "slider" }) as FakeInputElement;
    const hi = mk("input", { "data-lg-input": "", type: "number", role: "slider" }) as FakeInputElement;
    const errLo = mk("p", { "data-lg-error-for": "budget_min" });
    const q = mk("div", { "data-lg-question": "q_ft", "data-lg-field": "budget" }, [
      mk("div", { "data-lg-field": "budget_min" }, [lo]),
      mk("div", { "data-lg-field": "budget_max" }, [hi]),
      errLo,
    ]);
    const cont = mk("button", { "data-lg-continue": "" });
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q, cont]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    await boot(baseConfig([section("lgs_1", 0, [comp])]), root, { preview: true });
    lo.value = "90"; root.dispatch("input", lo);
    hi.value = "10"; root.dispatch("input", hi);
    root.dispatch("click", cont);
    expect(errLo.textContent).toBe("The first number must be less than or equal to the second.");
    expect(root.getAttribute("data-lg-complete")).toBeNull();
  });

  it("from_to required: only 'from' filled blocks Continue (both required)", async () => {
    const comp: LgComponentConfig = { type: "NumberRangeQuestion", question_id: "q_ft", internal_field: "budget", answer_type: "object", required: true, props: { slider_type: "from_to", min: 0, max: 100 }, client_validation: { required: true, min: 0, max: 100 } };
    DOC = fakeDocument();
    const lo = mk("input", { "data-lg-input": "", type: "number", role: "slider" }) as FakeInputElement;
    const hi = mk("input", { "data-lg-input": "", type: "number", role: "slider" }) as FakeInputElement;
    const errLo = mk("p", { "data-lg-error-for": "budget_min" });
    const q = mk("div", { "data-lg-question": "q_ft", "data-lg-field": "budget" }, [
      mk("div", { "data-lg-field": "budget_min" }, [lo]), mk("div", { "data-lg-field": "budget_max" }, [hi]), errLo,
    ]);
    const cont = mk("button", { "data-lg-continue": "" });
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q, cont]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    await boot(baseConfig([section("lgs_1", 0, [comp])]), root, { preview: true });
    lo.value = "20"; root.dispatch("input", lo);
    root.dispatch("click", cont);
    expect(errLo.textContent).toBe("This field is required.");
    expect(root.getAttribute("data-lg-complete")).toBeNull();
  });

  it("dual_range: two range handles record {base}_min/{base}_max (same data contract as from_to)", async () => {
    const comp: LgComponentConfig = { type: "NumberRangeQuestion", question_id: "q_d", internal_field: "yr", answer_type: "object", props: { slider_type: "dual_range", min: 1990, max: 2020 }, client_validation: { min: 1990, max: 2020 } };
    DOC = fakeDocument();
    const lo = mk("input", { "data-lg-input": "", type: "range", role: "slider", min: "1990", max: "2020" }) as FakeInputElement;
    lo.type = "range";
    const hi = mk("input", { "data-lg-input": "", type: "range", role: "slider", min: "1990", max: "2020" }) as FakeInputElement;
    hi.type = "range";
    const q = mk("div", { "data-lg-question": "q_d", "data-lg-field": "yr" }, [
      mk("div", { "data-lg-field": "yr_min" }, [lo]), mk("div", { "data-lg-field": "yr_max" }, [hi]),
    ]);
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q, mk("button", { "data-lg-continue": "" })]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    const { answers } = await boot(baseConfig([section("lgs_1", 0, [comp])]), root, { preview: true });
    lo.value = "2000"; root.dispatch("input", lo);
    hi.value = "2015"; root.dispatch("input", hi);
    expect(answers()["yr_min"]).toBe("2000");
    expect(answers()["yr_max"]).toBe("2015");
    expect(lo.getAttribute("aria-valuenow")).toBe("2000");
  });
});

// ---------------------------------------------------------------------------
// §6.5 — Other-select mutual exclusion
// ---------------------------------------------------------------------------

describe("§6.5 Other-select — record + deselect both directions through the real engine", () => {
  // FAITHFUL to presets otherSelectMarkup: data-lg-input AND data-lg-other-panel
  // ride the SAME <select> (NOT a wrapper div around it — the pre-fix false-green
  // structure), each option carries data-lg-choice, and the first option is the
  // "" placeholder. The old wrapper-div DOM let the base-click reset's DESCENDANT
  // selector "[data-lg-other-panel] [data-lg-input]" match; on the real
  // single-element select it never did, so the Other value kept displaying.
  function otherDom(): { root: FakeElement; yes: FakeElement; no: FakeElement; sel: FakeSelectElement } {
    DOC = fakeDocument();
    const yes = mk("button", { "data-lg-choice": "yes" });
    const no = mk("button", { "data-lg-choice": "no" });
    const sel = mk("select", { "data-lg-input": "", "data-lg-other-panel": "", hidden: "" }) as FakeSelectElement;
    sel.appendChild(mk("option", { value: "" }));
    sel.appendChild(mk("option", { value: "maybe", "data-lg-choice": "maybe" }));
    sel.appendChild(mk("option", { value: "unsure", "data-lg-choice": "unsure" }));
    const trigger = mk("button", { "data-lg-other-trigger": "", "aria-expanded": "false" });
    const q = mk("div", { "data-lg-question": "q_o", "data-lg-field": "pick" }, [yes, no, trigger, sel]);
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q, mk("button", { "data-lg-continue": "" })]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    return { root, yes, no, sel };
  }
  function otherConfig(): LgPublicConfig {
    return baseConfig([section("lgs_1", 0, [
      { type: "ButtonAnswerGroup", question_id: "q_o", internal_field: "pick", answer_type: "enum", props: { other: { enabled: true, label: "Other", choices: [{ value: "maybe", label: "Maybe", analytics_id: "m" }, { value: "unsure", label: "Unsure", analytics_id: "u" }] } }, choices: [{ label: "Yes", value: "yes", analytics_id: "y" }, { label: "No", value: "no", analytics_id: "n" }], valid_values: ["yes", "no", "maybe", "unsure"] },
    ])]);
  }

  it("picking a BASE choice, then an Other value: records the Other value + deselects the base", async () => {
    const dom = otherDom();
    const { answers } = await boot(otherConfig(), dom.root, { preview: true });
    dom.root.dispatch("click", dom.yes);
    expect(answers()["pick"]).toBe("yes");
    expect(dom.yes.classSet.has("lg-selected")).toBe(true);
    dom.sel.value = "maybe";
    dom.root.dispatch("change", dom.sel);
    expect(answers()["pick"]).toBe("maybe");
    expect(dom.yes.classSet.has("lg-selected")).toBe(false); // base deselected
  });

  it("picking an Other value, then a BASE choice: records the base + clears the Other select", async () => {
    const dom = otherDom();
    const { answers } = await boot(otherConfig(), dom.root, { preview: true });
    dom.sel.value = "unsure";
    dom.root.dispatch("change", dom.sel);
    expect(answers()["pick"]).toBe("unsure");
    dom.root.dispatch("click", dom.no);
    expect(answers()["pick"]).toBe("no");
    expect(dom.no.classSet.has("lg-selected")).toBe(true);
    expect(dom.sel.value).toBe(""); // Other select reset
  });

  it("the Other trigger reveals the panel (aria-expanded)", async () => {
    const dom = otherDom();
    await boot(otherConfig(), dom.root, { preview: true });
    const trigger = dom.root.querySelector("[data-lg-other-trigger]") as FakeElement;
    // The revealed panel IS the <select> (same element carries data-lg-other-panel).
    expect(dom.root.querySelector("[data-lg-other-panel]")).toBe(dom.sel);
    dom.root.dispatch("click", trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(dom.sel.hidden).toBe(false); // openOtherPanel toggled the hidden attr off
  });
});

// ---------------------------------------------------------------------------
// §6.10 — Address per-field validation
// ---------------------------------------------------------------------------

describe("§6.10 address — per-field required + none/zip5/{regex,message} through the real engine", () => {
  // FAITHFUL to the real producer path (config-dto compile + presets render):
  //  * the compiled config carries props.fields[] and NO props.internal_fields
  //    (the M9 studio writes only props.fields — ui-section-studio collectAddressFields;
  //    config-dto copies props verbatim), and the address node carries its own
  //    internal_field (the addrBase source);
  //  * the DOM keys each field's data-lg-field / data-lg-error-for by the RECORDER's
  //    own convention `{base}_{kind}` (presets m9AddressFieldName), NOT the bare kind.
  // The producer↔consumer coherence of these two keys (renderer data-lg-field ==
  // validator-derived key) is proven end-to-end, over the REAL presets render, in
  // test/leadgen-rework-routing.test.ts ("§6.10/M9 address key coherence"). Keying the
  // DOM on the bare kind (the pre-fix false-green) hid that the validator read a store
  // slot the recorder never wrote, so every authored address failed `required`.
  const ADDR_BASE = "mailing_address";
  const fieldKey = (kind: string): string => `${ADDR_BASE}_${kind}`;
  function addrConfig(): LgPublicConfig {
    return baseConfig([section("lgs_1", 0, [
      { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: ADDR_BASE, props: { fields: [
        { field: "street", required: true },
        { field: "city" },
        { field: "state", validation: { regex: "^[A-Z]{2}$", message: "Use the 2-letter state code." } },
        { field: "zip", validation: "zip5", required: true },
      ] } },
    ])]);
  }
  function addrDom(): { root: FakeElement; inputs: Record<string, FakeInputElement>; errs: Record<string, FakeElement>; cont: FakeElement } {
    DOC = fakeDocument();
    const inputs: Record<string, FakeInputElement> = {};
    const errs: Record<string, FakeElement> = {};
    const kids: FakeElement[] = [];
    for (const f of ["street", "city", "state", "zip"]) {
      const inp = mk("input", { "data-lg-input": "" }) as FakeInputElement;
      inputs[f] = inp;
      errs[f] = mk("p", { "data-lg-error-for": fieldKey(f) });
      kids.push(mk("span", { "data-lg-field": fieldKey(f) }, [inp, errs[f]]));
    }
    const q = mk("div", { "data-lg-question": "q_addr", "data-lg-field": ADDR_BASE }, kids);
    const cont = mk("button", { "data-lg-continue": "" });
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q, cont]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    return { root, inputs, errs, cont };
  }
  function set(root: FakeElement, inp: FakeInputElement, v: string): void { inp.value = v; root.dispatch("input", inp); }

  it("required street empty + zip 4-digit both block; city/state (no rule) do not; then all-valid passes", async () => {
    const dom = addrDom();
    const { state } = await boot(addrConfig(), dom.root, { preview: true });
    set(dom.root, dom.inputs["zip"] as FakeInputElement, "9021"); // 4 digits
    dom.root.dispatch("click", dom.cont);
    expect(dom.errs["street"]?.textContent).toBe("This field is required.");
    expect(dom.errs["zip"]?.textContent).toBe("Enter a valid 5-digit ZIP code.");
    expect(dom.errs["city"]?.textContent).toBe(""); // no rule → never validated
    expect(root0Complete(dom.root)).toBe(false);
    // fix
    set(dom.root, dom.inputs["street"] as FakeInputElement, "123 Main St");
    set(dom.root, dom.inputs["zip"] as FakeInputElement, "90210");
    dom.root.dispatch("click", dom.cont);
    expect(root0Complete(dom.root)).toBe(true);
    void state;
  });

  it("custom {regex,message} on state: 'ca' fails with the authored message, 'CA' passes", async () => {
    const dom = addrDom();
    await boot(addrConfig(), dom.root, { preview: true });
    set(dom.root, dom.inputs["street"] as FakeInputElement, "1 A St");
    set(dom.root, dom.inputs["zip"] as FakeInputElement, "90210");
    set(dom.root, dom.inputs["state"] as FakeInputElement, "ca");
    dom.root.dispatch("click", dom.cont);
    expect(dom.errs["state"]?.textContent).toBe("Use the 2-letter state code.");
    set(dom.root, dom.inputs["state"] as FakeInputElement, "CA");
    dom.root.dispatch("click", dom.cont);
    expect(root0Complete(dom.root)).toBe(true);
  });
});
function root0Complete(root: FakeElement): boolean { return root.getAttribute("data-lg-complete") === "1"; }

// ---------------------------------------------------------------------------
// §4.3-11 / §4.3-12 — progress recompute after a switch + auction trigger guard
// ---------------------------------------------------------------------------

describe("§4.3 — progress recompute after a funnel switch + auction fires only past the last page", () => {
  function multiSectionDom(ids: string[]): { root: FakeElement; conts: Record<string, FakeElement>; progress: FakeElement } {
    DOC = fakeDocument();
    const conts: Record<string, FakeElement> = {};
    const secs: FakeElement[] = ids.map((id, i) => {
      const cont = mk("button", { "data-lg-continue": "" });
      conts[id] = cont;
      const choice = mk("button", { "data-lg-choice": "ok" });
      const q = mk("div", { "data-lg-question": `q_${id}`, "data-lg-field": `f_${id}` }, [choice]);
      return mk("section", { "data-lg-section": "", "data-lg-section-id": id, "data-lg-index": String(i) }, [q, cont]);
    });
    const progress = mk("div", { "data-lg-progress": "", "data-mode": "step" });
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [...secs, progress])]);
    return { root, conts, progress };
  }
  const comp = (id: string): LgComponentConfig => ({ type: "ButtonAnswerGroup", question_id: `q_${id}`, internal_field: `f_${id}`, answer_type: "enum", props: {}, choices: [{ label: "Ok", value: "ok", analytics_id: "o" }] });
  const winner = (page: string, sec: string) => ({ page_id: page, section_public_id: sec, slot_id: "s", assignment_reason: "plan" });

  it("progress denominator recomputes after a /lg/ck switch (3 pages → 2 pages)", async () => {
    // Served plan = shared + funnelA(2 pages); a switch swaps to shared + funnelB(1 page).
    const dom = multiSectionDom(["lgs_shared", "lgs_a1", "lgs_a2", "lgs_b1"]);
    const cfg = baseConfig([
      section("lgs_shared", 0, [comp("lgs_shared")]),
      section("lgs_a1", 1, [comp("lgs_a1")]),
      section("lgs_a2", 2, [comp("lgs_a2")]),
      section("lgs_b1", 3, [comp("lgs_b1")]),
    ]);
    const fetchMock: FetchMock = (url) => {
      if (url.includes("/lg/attempt")) {
        return { json: { funnel_attempt_id: "att_1", signed_config_token: "tok", ctx: {}, cps: ["lgs_shared"], page_plan: [winner("pg0", "lgs_shared"), winner("pg1", "lgs_a1"), winner("pg2", "lgs_a2")] } };
      }
      if (url.includes("/lg/ck")) {
        return { json: { sw: true, k: "tok2", v: "lgn_2", so: "hash2", cv: 2, ar: "routing_rule:h", r: "lgs_b1", pp: [winner("pg0", "lgs_shared"), winner("pg1", "lgs_b1")] } };
      }
      return { status: 204 };
    };
    const { root } = await boot(cfg, dom.root, { preview: false, fetchMock });
    expect(dom.progress.getAttribute("data-lg-progress-total")).toBe("3"); // shared + funnelA(2)
    // Answer the shared page then Continue → checkpoint → /lg/ck switch.
    root.dispatch("click", root.querySelector('[data-lg-question="q_lgs_shared"] [data-lg-choice="ok"]') as FakeElement);
    root.dispatch("click", dom.conts["lgs_shared"] as FakeElement);
    await tick();
    expect(dom.progress.getAttribute("data-lg-progress-total")).toBe("2"); // recomputed: shared + funnelB(1)
  });

  it("auction fires only past the LAST page — the shared page alone does NOT finalize", async () => {
    const dom = multiSectionDom(["lgs_shared", "lgs_fn"]);
    const cfg = baseConfig([section("lgs_shared", 0, [comp("lgs_shared")]), section("lgs_fn", 1, [comp("lgs_fn")])]);
    const { root } = await boot(cfg, dom.root, { preview: true });
    // Shared page Continue → advances to the funnel page, NO auction.
    root.dispatch("click", root.querySelector('[data-lg-question="q_lgs_shared"] [data-lg-choice="ok"]') as FakeElement);
    root.dispatch("click", dom.conts["lgs_shared"] as FakeElement);
    expect(root.getAttribute("data-lg-complete")).toBeNull();
    // Last funnel page Continue → finalize (auction).
    root.dispatch("click", root.querySelector('[data-lg-question="q_lgs_fn"] [data-lg-choice="ok"]') as FakeElement);
    root.dispatch("click", dom.conts["lgs_fn"] as FakeElement);
    expect(root.getAttribute("data-lg-complete")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// §4.2 — answer-model invariants on the new widgets
// ---------------------------------------------------------------------------

describe("§4.2 — default provenance + hidden⇒not-required/not-persisted on the new widgets", () => {
  const attemptOnly: FetchMock = (u) => u.includes("/lg/attempt") ? { json: { funnel_attempt_id: "att_x", signed_config_token: "t", ctx: {} } } : { status: 204 };

  it("a defaulted single slider records default_applied on entry, then user_selected on change", async () => {
    // The slider carries a default; a trivial sibling text field gives a user
    // action that flushes a persist snapshot (the engine's only source-exposing
    // surface) WITHOUT touching the slider.
    const slider: LgComponentConfig = { type: "NumberRangeQuestion", question_id: "q_s", internal_field: "amt", answer_type: "number", props: { slider_type: "single", min: 0, max: 100 }, default_answer: { value: 50, answer_source: "default_applied" } };
    const note: LgComponentConfig = { type: "FreeTextQuestion", question_id: "q_n", internal_field: "note", props: {} };
    DOC = fakeDocument();
    const input = mk("input", { "data-lg-input": "", type: "range", role: "slider", min: "0", max: "100" }) as FakeInputElement;
    input.type = "range"; input.value = "50";
    const noteInput = mk("input", { "data-lg-input": "" }) as FakeInputElement;
    const q1 = mk("div", { "data-lg-question": "q_s", "data-lg-field": "amt" }, [mk("div", { class: "lg-range" }, [input])]);
    const q2 = mk("div", { "data-lg-question": "q_n", "data-lg-field": "note" }, [noteInput]);
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [q1, q2, mk("button", { "data-lg-continue": "" })]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    const { answers, snapshot } = await boot(baseConfig([section("lgs_1", 0, [slider, note])]), root, { preview: false, fetchMock: attemptOnly });
    expect(answers()["amt"]).toBe(50); // default applied on entry
    // Touch the SIBLING field → flushes a persist; the slider's source is intact.
    noteInput.value = "hi"; root.dispatch("input", noteInput);
    expect(snapshot()?.["amt"]?.answer_source).toBe("default_applied");
    // Now move the slider → user_selected.
    input.value = "75"; root.dispatch("input", input);
    expect(snapshot()?.["amt"]?.answer_source).toBe("user_selected");
  });

  it("a dependency-hidden required component does NOT block Continue and is NOT persisted (even after being answered)", async () => {
    // q_gate drives visibility of q_dep (shown only when gate === 'show'); q_dep
    // is REQUIRED. Two sections so "did not block" = advanced to section 1
    // (no real /lg/auction), and the persist excludes the hidden answer.
    const gate: LgComponentConfig = { type: "ButtonAnswerGroup", question_id: "q_gate", internal_field: "gate", answer_type: "enum", props: {}, choices: [{ label: "Hide", value: "hide", analytics_id: "h" }, { label: "Show", value: "show", analytics_id: "s" }] };
    const dep: LgComponentConfig = { type: "ButtonAnswerGroup", question_id: "q_dep", internal_field: "dep", answer_type: "enum", required: true, conditional: { when: "gate", op: "eq", value: "show" }, props: {}, choices: [{ label: "A", value: "a", analytics_id: "a" }], valid_values: ["a"], client_validation: { required: true } };
    const later: LgComponentConfig = { type: "FreeTextQuestion", question_id: "q_l", internal_field: "later", props: {} };
    DOC = fakeDocument();
    const gHide = mk("button", { "data-lg-choice": "hide" });
    const gShow = mk("button", { "data-lg-choice": "show" });
    const depA = mk("button", { "data-lg-choice": "a" });
    const qGate = mk("div", { "data-lg-question": "q_gate", "data-lg-field": "gate" }, [gHide, gShow]);
    const qDep = mk("div", { "data-lg-question": "q_dep", "data-lg-field": "dep" }, [depA]);
    const cont0 = mk("button", { "data-lg-continue": "" });
    const sec0 = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [qGate, qDep, cont0]);
    const sec1 = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_2", "data-lg-index": "1" }, [mk("div", { "data-lg-question": "q_l", "data-lg-field": "later" }, [mk("input", { "data-lg-input": "" })]), mk("button", { "data-lg-continue": "" })]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec0, sec1])]);
    const { answers, state, snapshot } = await boot(baseConfig([section("lgs_1", 0, [gate, dep]), section("lgs_2", 1, [later])]), root, { preview: false, fetchMock: attemptOnly });
    // Show → answer dep → hide again: dep is now answered in MEMORY but hidden.
    root.dispatch("click", gShow);
    root.dispatch("click", depA);
    expect(answers()["dep"]).toBe("a"); // in memory
    root.dispatch("click", gHide);
    // Continue: dep is hidden ⇒ its `required` must NOT block → advance to sec 1.
    root.dispatch("click", cont0);
    expect(state().section_index).toBe(1); // advanced, hidden-required did not block
    expect(answers()["dep"]).toBe("a"); // still in memory (back-nav)
    expect(snapshot()?.["dep"]).toBeUndefined(); // hidden ⇒ excluded from persistence (== the auction hiddenFields set)
  });

  it("a dependency-hidden field shadowed by an always-visible ValidationError does NOT leak its default into the /lg/auction projection (§4.2 hiddenAnswerFields)", async () => {
    // #2C shape (the S6.1b gap): the insurer dropdown (defaultValue 'geico',
    // REQUIRED, conditional show-if gate==='show') is hidden on entry because the
    // gate defaults to 'hide'; an AUTHORED ValidationError binds the SAME
    // internal_field ('insurer') for its error slot and carries NO conditional, so
    // it is always visible. Pre-fix that always-visible non-producing node un-hid
    // 'insurer' in hiddenAnswerFields ("hidden only when EVERY owning component is
    // hidden"), leaking its default_applied answer into the auction request body —
    // even though the producing dropdown was hidden. Only default-carrying fields
    // expose the leak, which is exactly the combination the existing gesture tests
    // (hidden-no-default / shown-with-default) never covered.
    const gate: LgComponentConfig = { type: "ButtonAnswerGroup", question_id: "q_gate", internal_field: "gate", answer_type: "enum", props: {}, choices: [{ label: "Hide", value: "hide", analytics_id: "h" }, { label: "Show", value: "show", analytics_id: "s" }], valid_values: ["hide", "show"], default_answer: { value: "hide", answer_source: "default_applied" } };
    const insurer: LgComponentConfig = { type: "DropdownQuestion", question_id: "q_ins", internal_field: "insurer", answer_type: "enum", required: true, conditional: { when: "gate", op: "eq", value: "show" }, props: {}, choices: [{ label: "GEICO", value: "geico", analytics_id: "g" }], valid_values: ["geico"], client_validation: { required: true }, default_answer: { value: "geico", answer_source: "default_applied" } };
    const insErr: LgComponentConfig = { type: "ValidationError", question_id: "q_ins_err", internal_field: "insurer", props: {} };
    DOC = fakeDocument();
    const qGate = mk("div", { "data-lg-question": "q_gate", "data-lg-field": "gate" }, [mk("button", { "data-lg-choice": "hide" }), mk("button", { "data-lg-choice": "show" })]);
    const qIns = mk("div", { "data-lg-question": "q_ins", "data-lg-field": "insurer" }, [mk("select", { "data-lg-input": "" })]);
    const insErrSlot = mk("p", { "data-lg-error-for": "insurer" });
    const cont = mk("button", { "data-lg-continue": "" });
    const sec = mk("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }, [qGate, qIns, insErrSlot, cont]);
    const root = mk("div", { id: "lg-funnel-root" }, [mk("main", { "data-lg-mount": "" }, [sec])]);
    const auctionMock: FetchMock = (u) =>
      u.includes("/lg/attempt")
        ? { json: { funnel_attempt_id: "att_2c", signed_config_token: "t", ctx: {} } }
        : u.includes("/lg/auction")
          ? { json: { unfilled: true, banners_html: "", auction_result_id: "", banner_render_id: "" } }
          : { status: 204 };
    const { win, answers } = await boot(baseConfig([section("lgs_1", 0, [gate, insurer, insErr])]), root, { preview: false, fetchMock: auctionMock });
    // Both defaults applied on entry; the insurer input is dependency-hidden.
    expect(answers()["insurer"]).toBe("geico"); // in memory (§3.5.3 back-nav)
    expect(answers()["gate"]).toBe("hide");
    // Continue on the only page ⇒ finalize ⇒ /lg/auction POST is built + sent.
    root.dispatch("click", cont);
    await tick();
    await tick();
    const calls = (win as { __lgCalls?: Array<{ url: string; body?: string }> }).__lgCalls ?? [];
    const auction = calls.find((c) => c.url.includes("/lg/auction"));
    expect(auction, "auction POST fired").toBeTruthy();
    const body = JSON.parse(auction?.body ?? "{}") as { answers: Record<string, { value: unknown }> };
    expect(body.answers["gate"]?.value, "the visible gate answer IS projected").toBe("hide");
    expect(body.answers["insurer"], "the hidden insurer default is ABSENT from the auction projection").toBeUndefined();
  });
});
