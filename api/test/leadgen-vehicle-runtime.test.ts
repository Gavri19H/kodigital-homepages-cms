// F18 Vehicle database — the visitor-side runtime (backlog F18 Section 3 parts
// E/F, owner decisions Q6/Q10): the Make → Year → Model lookups inside the
// existing engine bundle, the 1-second typed-answer fallback, the refill after
// a reload, the answer check, and the generic Searchable-dropdown filter.
//
// Drives the REAL runtime modules (runtime/vehicle.ts and runtime/engine.ts)
// over a hand-rolled fake DOM (repo "no new deps" rule; the same shape
// leadgen-r1-runtime-recording.test.ts uses). The DOM-lib modules are loaded
// with a variable-path dynamic import so this file stays in the WORKER
// typecheck program (the runtime modules are browser code, checked by
// tsconfig.runtime.json) — the shapes used here are declared locally below.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig, LgPublicConfig } from "../src/public/leadgen/runtime/state";
import { VEHICLE_LOOKUP_TIMEOUT_MS } from "../src/leadgen/vehicles/props";
import { VEHICLE_API_BASE, vehicleMakeUrl } from "../src/leadgen/vehicles/format";

// ---------------------------------------------------------------------------
// Fake DOM
// ---------------------------------------------------------------------------

function matchesSimple(el: FakeElement, raw: string): boolean {
  const sel = raw.trim();
  if (sel.startsWith(".")) return el.classSet.has(sel.slice(1));
  if (/^[a-z]+$/.test(sel)) return el.tag === sel;
  const m = sel.match(/^([a-z]*)\[([^\]=]+)(?:="((?:[^"\\]|\\.)*)")?\]$/);
  if (m === null || (m[1] !== "" && m[1] !== el.tag)) return false;
  m.splice(1, 1);
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
  ownerDocument: unknown;

  constructor(tag = "div", attrs: Record<string, string> = {}, text = "") {
    this.tag = tag;
    this.textContent = text;
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") for (const c of v.split(/\s+/)) { if (c !== "") this.classSet.add(c); }
      else this.attrs.set(k, v);
    }
  }
  get hidden(): boolean { return this.attrs.has("hidden"); }
  get classList() {
    const set = this.classSet;
    return {
      add: (c: string) => void set.add(c),
      remove: (c: string) => void set.delete(c),
      contains: (c: string) => set.has(c),
      toggle: (c: string, on?: boolean) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)),
    };
  }
  getAttribute(name: string): string | null {
    if (name === "class") return [...this.classSet].join(" ");
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }
  setAttribute(name: string, value: string): void { this.attrs.set(name, String(value)); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  appendChild<T extends FakeElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...kids: FakeElement[]): this { for (const k of kids) this.appendChild(k); return this; }
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
    for (const fn of this.listeners.get(type) ?? []) fn({ target, type });
  }
  focus(): void {}
}

class FakeInputElement extends FakeElement {
  type = "text";
  value = "";
  checked = false;
  constructor(attrs: Record<string, string> = {}) { super("input", attrs); }
}

class FakeOption extends FakeElement {
  value: string;
  selected = false;
  constructor(text = "", value = "", attrs: Record<string, string> = {}) {
    super("option", attrs, text);
    this.value = value;
  }
  get text(): string { return this.textContent; }
  // A real <option>'s value is also its `value` attribute.
  override getAttribute(name: string): string | null { return name === "value" ? this.value : super.getAttribute(name); }
}

// A native <select>: `value` = the selected option's value ("" when none);
// setting it selects the first option with that value (disabled or not), or
// none. `length = n` drops every option after the first n.
class FakeSelectElement extends FakeElement {
  constructor(attrs: Record<string, string> = {}) { super("select", attrs); }
  get options(): FakeOption[] { return this.children.filter((c): c is FakeOption => c instanceof FakeOption); }
  get length(): number { return this.options.length; }
  set length(n: number) {
    const drop = new Set(this.options.slice(n));
    for (const o of drop) o.parentElement = null;
    this.children = this.children.filter((c) => !drop.has(c as FakeOption));
  }
  add(o: FakeOption): void { this.appendChild(o); }
  get value(): string { return this.options.find((o) => o.selected)?.value ?? ""; }
  set value(v: string) {
    let hit = false;
    for (const o of this.options) { o.selected = !hit && o.value === v; if (o.selected) hit = true; }
  }
  labels(): string[] { return this.options.slice(1).map((o) => o.text); }
  values(): string[] { return this.options.slice(1).map((o) => o.value); }
}

function fakeSessionStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

function stubBrowser(storageSeed: Record<string, string> = {}): Record<string, unknown> {
  const doc = {
    cookie: "", referrer: "", visibilityState: "visible", head: new FakeElement("head"),
    createElement: (tag: string) => (tag === "input" ? new FakeInputElement() : new FakeElement(tag)),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => undefined,
  };
  const win: Record<string, unknown> = { sessionStorage: fakeSessionStorage(storageSeed), parent: { postMessage: () => undefined } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { href: "https://one.example.com/lg/car", search: "" });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
  vi.stubGlobal("Option", FakeOption);
  return win;
}

// ---------------------------------------------------------------------------
// The runtime modules (browser code — loaded fresh per test, see header)
// ---------------------------------------------------------------------------

type Opt = [string, string];
interface VehicleModule {
  LG_VEHICLE_TIMEOUT_MS: number;
  vehicleFile(v: { snapshot: string; base: string }, make: string): Promise<unknown>;
  vehicleOptions(f: unknown, asks: string, year: unknown): Opt[];
  vehicleFill(q: unknown, opts: Opt[] | null, saved: unknown): void;
  lgSearch(box: unknown): void;
}
interface EngineModule {
  LgEngine: new (root: unknown, config: LgPublicConfig, preview: boolean) => { init(): Promise<void> };
}
const VEHICLE_MODULE = "../src/public/leadgen/runtime/vehicle";
const ENGINE_MODULE = "../src/public/leadgen/runtime/engine";
const loadVehicle = (): Promise<VehicleModule> => import(/* @vite-ignore */ VEHICLE_MODULE) as Promise<VehicleModule>;
const loadEngine = (): Promise<EngineModule> => import(/* @vite-ignore */ ENGINE_MODULE) as Promise<EngineModule>;

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

// ---------------------------------------------------------------------------
// Fixtures: a make file in the served shape (format.ts VehicleMakeFile)
// ---------------------------------------------------------------------------

const SNAPSHOT = "2026-10-05";
const TOYOTA = {
  snapshot: SNAPSHOT,
  make_id: 448,
  models: [
    { model_id: "m_000000000a", name: "4Runner" },
    { model_id: "m_000000000b", name: "bZ4X" },
    { model_id: "m_000000000c", name: "Camry" },
    { model_id: "m_000000000d", name: "Corolla" },
    { model_id: "m_000000000e", name: "Supra" },
  ],
  years: [
    { year: 2027, m: [2, 3] },
    { year: 2026, m: [2] },
    { year: 2023, m: [3, 0, 1, 2] },
    { year: 2001, m: [2, 3] },
  ],
};
const HONDA = { snapshot: SNAPSHOT, make_id: 474, models: [{ model_id: "m_00000000f1", name: "Civic" }], years: [{ year: 2020, m: [0] }] };
const FILES: Record<string, unknown> = { "448": TOYOTA, "474": HONDA };

type FetchStub = ReturnType<typeof vi.fn>;
function stubFetch(mode: "ok" | "fail" | "hang" = "ok", attempt?: Record<string, unknown>): FetchStub {
  const fn = vi.fn(async (url: string, init?: { signal?: AbortSignal }): Promise<Response> => {
    if (url.startsWith("/lg/attempt")) return new Response(JSON.stringify(attempt ?? {}), { status: 200 });
    const m = /\/makes\/(\d+)$/.exec(url);
    if (m === null) return new Response(null, { status: 204 });
    if (mode === "fail") return new Response("{}", { status: 503 });
    if (mode === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const file = FILES[m[1] ?? ""];
    return file === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(file), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const vehicleCalls = (f: FetchStub): string[] =>
  f.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(VEHICLE_API_BASE));

// ---------------------------------------------------------------------------
// A three-page car funnel in the presets.ts markup contract
// ---------------------------------------------------------------------------

interface Funnel {
  root: FakeElement;
  make: FakeElement;
  toyota: FakeElement;
  makeOther: FakeSelectElement;
  makeText: FakeInputElement;
  plainHeadline: FakeElement;
  yearHeadline: FakeElement;
  modelSub: FakeElement;
  year: FakeElement;
  slots: FakeElement[];
  yearTrigger: FakeElement;
  yearOther: FakeSelectElement;
  yearText: FakeInputElement;
  model: FakeElement;
  modelSearch: FakeInputElement;
  modelSelect: FakeSelectElement;
  modelText: FakeInputElement;
}

function buildFunnel(opts: { yearAndModelTogether?: boolean } = {}): Funnel {
  const root = new FakeElement("div", { id: "lg-funnel-root" });
  const mount = root.appendChild(new FakeElement("main", { "data-lg-mount": "" }));
  const section = (id: string, index: number): FakeElement =>
    mount.appendChild(new FakeElement("section", { "data-lg-section": "", "data-lg-section-id": id, "data-lg-index": String(index), ...(index > 0 ? { hidden: "" } : {}) }));
  const s0 = section("lgs_make", 0);
  const s1 = section("lgs_year", 1);
  const s2 = opts.yearAndModelTogether === true ? s1 : section("lgs_model", 2);

  // Make — logo cards + "Other make".
  const make = s0.appendChild(new FakeElement("div", { class: "lg-card-grid", "data-lg-question": "q_make", "data-lg-field": "vehicle_make", "data-lg-vehicle": "make", "data-lg-vlogos": "" }));
  const toyota = make.appendChild(new FakeElement("button", { class: "lg-card", "data-value": "448", "data-lg-choice": "448" }, " Toyota "));
  make.appendChild(new FakeElement("button", { class: "lg-card", "data-value": "499", "data-lg-choice": "499" }));
  make.appendChild(new FakeElement("button", { class: "lg-card lg-other-trigger", "data-lg-other-trigger": "" }));
  const makeOther = make.appendChild(new FakeSelectElement({ class: "lg-input lg-other-select lg-other-panel", "data-lg-input": "", "data-lg-other-panel": "", hidden: "" }));
  makeOther.append(new FakeOption("Choose…", "", { disabled: "" }), new FakeOption("Honda", "474"));
  // The typed-answer box a Make gets when the page had no readable list.
  const makeText = make.appendChild(new FakeInputElement({ class: "lg-input lg-vehicle-text", "data-lg-input": "", "data-lg-vtext": "" }));
  // Section headlines with the {make}/{year} names (and one without).
  const plainHeadline = s0.appendChild(new FakeElement("h1", { class: "lg-headline" }, "What do you drive?"));
  const yearHeadline = s1.appendChild(new FakeElement("h1", { class: "lg-headline" }, "What year is your {make}?"));
  const modelSub = s2.appendChild(new FakeElement("p", { class: "lg-subheadline" }, "Which {year} {make} is it?"));

  // Year — 2 card slots + "Older year" + the typed-answer box.
  const year = s1.appendChild(new FakeElement("div", { class: "lg-card-grid", "data-lg-question": "q_year", "data-lg-field": "vehicle_year", "data-lg-vehicle": "year", "data-lg-vmake": "vehicle_make", "data-lg-vcards": "2" }));
  const slots = [0, 1].map(() => {
    const b = year.appendChild(new FakeElement("button", { class: "lg-card", "data-lg-vslot": "", hidden: "" }));
    b.appendChild(new FakeElement("span", { class: "lg-card-title" }));
    return b;
  });
  const yearTrigger = year.appendChild(new FakeElement("button", { class: "lg-card lg-other-trigger", "data-lg-other-trigger": "", hidden: "" }));
  const yearOther = year.appendChild(new FakeSelectElement({ class: "lg-input lg-other-select lg-other-panel", "data-lg-input": "", "data-lg-other-panel": "", hidden: "" }));
  yearOther.append(new FakeOption("Choose…", "", { disabled: "" }));
  const yearText = year.appendChild(new FakeInputElement({ class: "lg-input lg-vehicle-text", "data-lg-input": "", "data-lg-vtext": "", hidden: "" }));

  // Model — a searchable dropdown + the typed-answer box.
  const model = s2.appendChild(new FakeElement("div", { class: "lg-searchable-dropdown", "data-lg-question": "q_model", "data-lg-field": "vehicle_model", "data-lg-vehicle": "model", "data-lg-vmake": "vehicle_make", "data-lg-vyear": "vehicle_year", "data-lg-searchable": "" }));
  const modelSearch = model.appendChild(new FakeInputElement({ class: "lg-input lg-dropdown-search", "data-lg-dropdown-search": "" }));
  const modelSelect = model.appendChild(new FakeSelectElement({ class: "lg-input lg-dropdown", "data-lg-input": "" }));
  modelSelect.append(new FakeOption("Select…", "", { disabled: "" }));
  const modelText = model.appendChild(new FakeInputElement({ class: "lg-input lg-vehicle-text", "data-lg-input": "", "data-lg-vtext": "", hidden: "" }));
  return { root, make, toyota, makeOther, makeText, plainHeadline, yearHeadline, modelSub, year, slots, yearTrigger, yearOther, yearText, model, modelSearch, modelSelect, modelText };
}

const vehicleProps = (asks: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  choice_source: "vehicle",
  vehicle_asks: asks,
  ...extra,
});

function funnelConfig(opts: { yearAndModelTogether?: boolean; vehicle?: boolean } = {}): LgPublicConfig {
  const makeC: LgComponentConfig = { type: "IconCardAnswerGrid", question_id: "q_make", internal_field: "vehicle_make", answer_type: "string", required: true, props: vehicleProps("make") };
  const yearC: LgComponentConfig = { type: "ButtonAnswerGroup", question_id: "q_year", internal_field: "vehicle_year", answer_type: "number", required: true, props: vehicleProps("year", { vehicle_make_field: "vehicle_make", vehicle_year_cards: 2 }) };
  const modelC: LgComponentConfig = { type: "SearchableDropdownQuestion", question_id: "q_model", internal_field: "vehicle_model", answer_type: "string", required: true, props: vehicleProps("model", { vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_year" }) };
  const section = (id: string, index: number, components: LgComponentConfig[]) => ({
    section_public_id: id, section_index: index, headline: "H", continue_mode: "button",
    address_validation_enabled: false, section_mapping_version: 0, answer_mapping_version: "0", components,
  });
  const sections = opts.yearAndModelTogether === true
    ? [section("lgs_make", 0, [makeC]), section("lgs_year", 1, [yearC, modelC])]
    : [section("lgs_make", 0, [makeC]), section("lgs_year", 1, [yearC]), section("lgs_model", 2, [modelC])];
  return {
    quote_id: "lgq_1", funnel_id: "lgf_1", funnel_variant_id: "lgn_1", funnel_name: "Car",
    content_version: 1, funnel_design_id: "default", design_tokens: {},
    section_order_hash: "hash_1", ga4_measurement_id: null,
    funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "",
    traffic_allocation_bp: 10000, assignment_reason: "single_control",
    sections,
    ...(opts.vehicle === false ? {} : { vehicle: { snapshot: SNAPSHOT, base: VEHICLE_API_BASE } }),
  };
}

interface Booted {
  dom: Funnel;
  config: LgPublicConfig;
  answers: () => Record<string, unknown>;
  comp: (qid: string) => LgComponentConfig;
}
async function boot(opts: { yearAndModelTogether?: boolean; vehicle?: boolean; preview?: boolean; storage?: Record<string, string> } = {}): Promise<Booted> {
  const win = stubBrowser(opts.storage);
  const dom = buildFunnel(opts);
  const config = funnelConfig(opts);
  const { LgEngine } = await loadEngine();
  await new LgEngine(dom.root, config, opts.preview !== false).init();
  await flush();
  const api = () => win["__LG_ENGINE__"] as { getAnswers: () => Record<string, unknown> };
  const comp = (qid: string): LgComponentConfig =>
    config.sections.flatMap((s) => s.components).find((c) => c.question_id === qid) as LgComponentConfig;
  return { dom, config, answers: () => api().getAnswers(), comp };
}

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

describe("F18 runtime — shared numbers and the make file", () => {
  it("the runtime's 1-second limit and lookup address match leadgen/vehicles", async () => {
    const v = await loadVehicle();
    expect(v.LG_VEHICLE_TIMEOUT_MS).toBe(VEHICLE_LOOKUP_TIMEOUT_MS);
    const f = stubFetch("ok");
    await v.vehicleFile({ snapshot: SNAPSHOT, base: VEHICLE_API_BASE }, "448");
    expect(String(f.mock.calls[0]?.[0])).toBe(vehicleMakeUrl(SNAPSHOT, 448));
  });

  it("Year lists every model year newest first; Model lists the picked year's models A→Z; an unknown year lists none", async () => {
    const v = await loadVehicle();
    expect(v.vehicleOptions(structuredClone(TOYOTA), "year", undefined)).toEqual([
      ["2027", "2027"], ["2026", "2026"], ["2023", "2023"], ["2001", "2001"],
    ]);
    // 2023's indexes are stored out of order on purpose: shown A→Z, real casing kept.
    expect(v.vehicleOptions(structuredClone(TOYOTA), "model", 2023)).toEqual([
      ["4Runner", "m_000000000a"], ["bZ4X", "m_000000000b"], ["Camry", "m_000000000c"], ["Corolla", "m_000000000d"],
    ]);
    // The visitor's own typed year ("2023") finds the same list.
    expect(v.vehicleOptions(structuredClone(TOYOTA), "model", "2023")).toHaveLength(4);
    expect(v.vehicleOptions(structuredClone(TOYOTA), "model", 1999)).toEqual([]);
  });

  it("ONE request per make (kept in memory); a failed one is forgotten so a later pick retries", async () => {
    const v = await loadVehicle();
    const cfg = { snapshot: SNAPSHOT, base: VEHICLE_API_BASE };
    const ok = stubFetch("ok");
    await Promise.all([v.vehicleFile(cfg, "448"), v.vehicleFile(cfg, "448")]);
    await v.vehicleFile(cfg, "448");
    expect(vehicleCalls(ok)).toEqual([vehicleMakeUrl(SNAPSHOT, 448)]);
    const bad = stubFetch("fail");
    await expect(v.vehicleFile(cfg, "474")).rejects.toBeDefined();
    stubFetch("ok");
    await expect(v.vehicleFile(cfg, "474")).resolves.toMatchObject({ make_id: 474 });
    expect(vehicleCalls(bad)).toHaveLength(1);
  });

  it("the lookup gives up after 1 second (AbortController)", async () => {
    const v = await loadVehicle();
    vi.useFakeTimers();
    stubFetch("hang");
    let failed = false;
    v.vehicleFile({ snapshot: SNAPSHOT, base: VEHICLE_API_BASE }, "448").catch(() => { failed = true; });
    vi.advanceTimersByTime(VEHICLE_LOOKUP_TIMEOUT_MS - 1);
    await flush();
    expect(failed).toBe(false);
    vi.advanceTimersByTime(1);
    await flush();
    expect(failed).toBe(true);
  });
});

describe("F18 runtime — the Searchable dropdown filter (generic)", () => {
  function typedSearchable(): { wrap: FakeElement; box: FakeInputElement; sel: FakeSelectElement } {
    const wrap = new FakeElement("div", { class: "lg-searchable-dropdown", "data-lg-question": "q_ins", "data-lg-field": "insurer", "data-lg-searchable": "" });
    const box = wrap.appendChild(new FakeInputElement({ "data-lg-dropdown-search": "" }));
    const sel = wrap.appendChild(new FakeSelectElement({ "data-lg-input": "" }));
    sel.append(
      new FakeOption("Select…", "", { disabled: "" }),
      new FakeOption("Allstate", "allstate", { "data-lg-choice": "allstate" }),
      new FakeOption("GEICO", "geico", { "data-lg-choice": "geico" }),
      new FakeOption("Progressive", "progressive", { "data-lg-choice": "progressive" }),
      new FakeOption("State Farm", "state_farm", { "data-lg-choice": "state_farm" }),
    );
    return { wrap, box, sel };
  }

  it("typing narrows the list to labels containing the text (any case), keeps the placeholder and the picked value, and clearing brings every option back", async () => {
    stubBrowser();
    const v = await loadVehicle();
    const { box, sel } = typedSearchable();
    sel.value = "geico";
    box.value = "STATE";
    v.lgSearch(box);
    expect(sel.options[0]?.text).toBe("Select…");
    // "GEICO" stays: it is the visitor's current pick.
    expect(sel.labels()).toEqual(["Allstate", "GEICO", "State Farm"]);
    expect(sel.value).toBe("geico");
    // The SAME option elements come back (their data-lg-choice etc. intact).
    expect(sel.options[3]?.getAttribute("data-lg-choice")).toBe("state_farm");
    box.value = "";
    v.lgSearch(box);
    expect(sel.labels()).toEqual(["Allstate", "GEICO", "Progressive", "State Farm"]);
  });

  it("the engine routes typing in the search box to the filter (it records no answer)", async () => {
    stubBrowser();
    stubFetch("ok");
    const { root, box, sel, wrap } = ((): { root: FakeElement } & ReturnType<typeof typedSearchable> => {
      const root = new FakeElement("div", { id: "lg-funnel-root" });
      const section = root.appendChild(new FakeElement("section", { "data-lg-section": "", "data-lg-section-id": "lgs_1", "data-lg-index": "0" }));
      const t = typedSearchable();
      section.appendChild(t.wrap);
      return { root, ...t };
    })();
    void wrap;
    const config = funnelConfig({ vehicle: false });
    config.sections = [{ ...config.sections[0]!, section_public_id: "lgs_1", components: [{ type: "SearchableDropdownQuestion", question_id: "q_ins", internal_field: "insurer", props: {} }] }];
    const { LgEngine } = await loadEngine();
    await new LgEngine(root, config, true).init();
    box.value = "pro";
    root.dispatch("input", box);
    expect(sel.labels()).toEqual(["Progressive"]);
    const answers = (((globalThis as unknown as Record<string, Record<string, unknown>>)["window"] ?? {})["__LG_ENGINE__"] as { getAnswers: () => Record<string, unknown> }).getAnswers();
    expect(answers["insurer"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The engine over the three-page car funnel
// ---------------------------------------------------------------------------

describe("F18 runtime — Make → Year → Model in the engine", () => {
  it("picking a make saves its id + the snapshot, makes ONE lookup, and fills Year (newest N as cards, the rest under 'Older year'); Year → Model makes no further call", async () => {
    const f = stubFetch("ok");
    const { dom, answers, comp } = await boot();
    expect(vehicleCalls(f)).toEqual([]); // nothing on page load (P2)

    dom.root.dispatch("click", dom.toyota);
    expect(answers()["vehicle_make"]).toBe("448");
    expect(answers()["vehicle_make_snapshot"]).toBe(SNAPSHOT);
    await flush();
    expect(vehicleCalls(f)).toEqual([vehicleMakeUrl(SNAPSHOT, 448)]);

    // Year cards: 2027, 2026; "Older year" lists 2023, 2001.
    expect(dom.slots.map((s) => [s.hidden, s.getAttribute("data-lg-choice"), s.querySelector(".lg-card-title")?.textContent])).toEqual([
      [false, "2027", "2027"],
      [false, "2026", "2026"],
    ]);
    expect(dom.yearTrigger.hidden).toBe(false);
    expect(dom.yearOther.values()).toEqual(["2023", "2001"]);
    expect(dom.yearOther.hidden).toBe(true);
    expect(dom.yearText.hidden).toBe(true);
    // The answer check accepts only the filled years.
    expect(comp("q_year").valid_values).toEqual(["2027", "2026", "2023", "2001"]);

    // An older year from the "Older year" list: saved as a NUMBER.
    dom.yearOther.value = "2023";
    dom.root.dispatch("change", dom.yearOther);
    expect(answers()["vehicle_year"]).toBe(2023);
    await flush();
    expect(dom.modelSelect.labels()).toEqual(["4Runner", "bZ4X", "Camry", "Corolla"]);
    expect(dom.modelText.hidden).toBe(true);
    expect(vehicleCalls(f)).toHaveLength(1);

    // Model: the search box narrows the same list; a pick saves the model_id.
    dom.modelSearch.value = "co";
    dom.root.dispatch("input", dom.modelSearch);
    expect(dom.modelSelect.labels()).toEqual(["Corolla"]);
    dom.modelSelect.value = "m_000000000d";
    dom.root.dispatch("change", dom.modelSelect);
    expect(answers()["vehicle_model"]).toBe("m_000000000d");
  });

  it("a card year is saved as a number and selected; the answer check refuses a year the make does not have", async () => {
    stubFetch("ok");
    const { dom, answers, comp } = await boot();
    dom.root.dispatch("click", dom.toyota);
    await flush();
    dom.root.dispatch("click", dom.slots[1]!);
    expect(answers()["vehicle_year"]).toBe(2026);
    expect(dom.slots[1]!.classSet.has("lg-selected")).toBe(true);
    expect(validateValue(comp("q_year"), 2026, true)).toEqual([]);
    expect(validateValue(comp("q_year"), 1999, true).map((x) => x.code)).toEqual(["invalid_value"]);
  });

  it("picking a different make clears the Year and Model answers and refills from the new make", async () => {
    const f = stubFetch("ok");
    const { dom, answers } = await boot();
    dom.root.dispatch("click", dom.toyota);
    await flush();
    dom.root.dispatch("click", dom.slots[0]!);
    await flush();
    dom.modelSelect.value = "m_000000000c";
    dom.root.dispatch("change", dom.modelSelect);
    expect(answers()["vehicle_model"]).toBe("m_000000000c");

    // Honda from the "Other make" list.
    dom.makeOther.value = "474";
    dom.root.dispatch("change", dom.makeOther);
    expect(answers()["vehicle_make"]).toBe("474");
    expect(dom.toyota.classSet.has("lg-selected")).toBe(false);
    expect(answers()["vehicle_year"]).toBeUndefined();
    expect(answers()["vehicle_model"]).toBeUndefined();
    await flush();
    expect(dom.slots.map((s) => [s.hidden, s.getAttribute("data-lg-choice")])).toEqual([[false, "2020"], [true, null]]);
    expect(dom.yearTrigger.hidden).toBe(true);
    expect(vehicleCalls(f)).toEqual([vehicleMakeUrl(SNAPSHOT, 448), vehicleMakeUrl(SNAPSHOT, 474)]);
  });

  it("a failed lookup turns Year and Model into their typed-answer box, saving to the same field (Q6)", async () => {
    stubFetch("fail");
    const { dom, answers, comp } = await boot();
    dom.root.dispatch("click", dom.toyota);
    await flush();
    expect(dom.yearText.hidden).toBe(false);
    expect(dom.slots.every((s) => s.hidden)).toBe(true);
    expect(dom.yearTrigger.hidden).toBe(true);
    expect(dom.yearOther.hidden).toBe(true);
    expect(dom.modelText.hidden).toBe(false);
    expect(dom.modelSelect.hidden).toBe(true);
    expect(dom.modelSearch.hidden).toBe(true);
    // No allowed list in typed mode: any text passes the check.
    expect(comp("q_model").valid_values).toBeUndefined();
    dom.yearText.value = "2019";
    dom.root.dispatch("input", dom.yearText);
    expect(answers()["vehicle_year"]).toBe(2019);
    dom.modelText.value = "Corolla LE";
    dom.root.dispatch("input", dom.modelText);
    expect(answers()["vehicle_model"]).toBe("Corolla LE");
    expect(validateValue(comp("q_model"), "Corolla LE", true)).toEqual([]);
  });

  it("a lookup slower than 1 second turns the question into its typed-answer box (P7)", async () => {
    stubFetch("hang");
    const { dom } = await boot();
    vi.useFakeTimers();
    dom.root.dispatch("click", dom.toyota);
    await flush();
    expect(dom.yearText.hidden).toBe(true); // still waiting
    vi.advanceTimersByTime(VEHICLE_LOOKUP_TIMEOUT_MS);
    await flush();
    expect(dom.yearText.hidden).toBe(false);
  });

  it("Year and Model on ONE page: Model waits (no choices, no text box) until a year is picked", async () => {
    stubFetch("ok");
    const { dom } = await boot({ yearAndModelTogether: true });
    dom.root.dispatch("click", dom.toyota);
    await flush();
    expect(dom.modelText.hidden).toBe(true);
    expect(dom.modelSelect.labels()).toEqual([]);
    dom.root.dispatch("click", dom.slots[0]!);
    await flush();
    expect(dom.modelSelect.labels()).toEqual(["Camry", "Corolla"]);
  });

  it("without the live list (no config.vehicle) nothing is fetched and the server-rendered boxes stay as they are", async () => {
    const f = stubFetch("ok");
    const { dom, answers } = await boot({ vehicle: false });
    dom.root.dispatch("click", dom.toyota);
    await flush();
    expect(vehicleCalls(f)).toEqual([]);
    expect(answers()["vehicle_make_snapshot"]).toBeUndefined();
    expect(dom.slots.every((s) => s.hidden)).toBe(true);
    // The page rendered every vehicle question as a text box; a typed year
    // still saves as a number, and the Make text never clears it.
    dom.yearText.value = "2018";
    dom.root.dispatch("input", dom.yearText);
    dom.root.dispatch("click", dom.make.querySelector('[data-lg-choice="499"]')!);
    expect(answers()["vehicle_year"]).toBe(2018);
  });

  it("after a reload the saved make is looked up again and the saved Year card and Model are re-selected", async () => {
    const f = stubFetch("ok", { funnel_attempt_id: "att_new", signed_config_token: "tok", ctx: {} });
    const entry = (value: unknown, qid: string, sid: string) => ({ value, answer_source: "user_selected", question_id: qid, section_public_id: sid, answered_at: 1 });
    const snapshot = {
      v: 1,
      tuple: { funnel_variant_id: "lgn_1", section_order_hash: "hash_1", content_version: 1 },
      section_index: 1,
      back_stack: [0],
      answers: {
        vehicle_make: entry("448", "q_make", "lgs_make"),
        vehicle_make_snapshot: entry(SNAPSHOT, "q_make", "lgs_make"),
        vehicle_year: entry(2026, "q_year", "lgs_year"),
        vehicle_model: entry("m_000000000c", "q_model", "lgs_year"),
      },
      saved_at: 1,
    };
    const { dom, answers } = await boot({ yearAndModelTogether: true, preview: false, storage: { "lg:att_old": JSON.stringify(snapshot) } });
    expect(answers()["vehicle_year"]).toBe(2026);
    expect(vehicleCalls(f)).toEqual([vehicleMakeUrl(SNAPSHOT, 448)]);
    expect(dom.slots[1]!.getAttribute("data-lg-choice")).toBe("2026");
    expect(dom.slots[1]!.classSet.has("lg-selected")).toBe(true);
    expect(dom.slots[0]!.classSet.has("lg-selected")).toBe(false);
    expect(dom.modelSelect.labels()).toEqual(["Camry"]);
    expect(dom.modelSelect.value).toBe("m_000000000c");
  });

  it("a saved year from the 'Older year' list re-opens that list with the year chosen", async () => {
    stubBrowser();
    const v = await loadVehicle();
    const dom = buildFunnel();
    v.vehicleFill(dom.year, [["2027", "2027"], ["2026", "2026"], ["2023", "2023"]], 2023);
    expect(dom.yearOther.hidden).toBe(false);
    expect(dom.yearOther.value).toBe("2023");
    v.vehicleFill(dom.year, null, 2023);
    expect(dom.yearOther.hidden).toBe(true);
    expect(dom.yearText.hidden).toBe(false);
    expect(dom.yearText.value).toBe("2023");
  });
});

describe("F18 runtime — {make}/{year} headline names", () => {
  it("on page entry with no answers: {make} → \"car\", {year} → nothing (no double space); a headline without a token is never rewritten", async () => {
    stubFetch("ok");
    const { dom } = await boot();
    expect(dom.yearHeadline.textContent).toBe("What year is your car?");
    expect(dom.modelSub.textContent).toBe("Which car is it?");
    expect(dom.plainHeadline.textContent).toBe("What do you drive?");
  });

  it("the picked make's display name (card or 'Other make' list) and the year fill in, and change again when the answers change", async () => {
    stubFetch("ok");
    const { dom } = await boot();
    dom.root.dispatch("click", dom.toyota);
    await flush();
    expect(dom.yearHeadline.textContent).toBe("What year is your Toyota?");
    dom.root.dispatch("click", dom.slots[1]!); // 2026
    await flush();
    expect(dom.modelSub.textContent).toBe("Which 2026 Toyota is it?");
    // A different make from the "Other make" list: its name, and the year it cleared is gone.
    dom.makeOther.value = "474";
    dom.root.dispatch("change", dom.makeOther);
    await flush();
    expect(dom.yearHeadline.textContent).toBe("What year is your Honda?");
    expect(dom.modelSub.textContent).toBe("Which Honda is it?");
  });

  it("a typed make (no readable list) shows as the visitor typed it — as text, never HTML — and a typed year too", async () => {
    stubFetch("ok");
    const { dom } = await boot({ vehicle: false });
    dom.makeText.value = "Tesla <b>Roadster</b>";
    dom.root.dispatch("input", dom.makeText);
    dom.yearText.value = "2019";
    dom.root.dispatch("input", dom.yearText);
    await flush();
    expect(dom.yearHeadline.textContent).toBe("What year is your Tesla <b>Roadster</b>?");
    expect(dom.modelSub.textContent).toBe("Which 2019 Tesla <b>Roadster</b> is it?");
    expect("innerHTML" in dom.yearHeadline).toBe(false);
  });
});
