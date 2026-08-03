// LeadGen runtime — BROWSER-module regressions over a minimal fake DOM
// (fix-contract v2.4 Phase-1 adversarial findings M2/M3/M4/m7/m12/m2/M5).
//
// The runtime engine/maps/render modules are browser modules ("window/DOM
// access strictly inside functions") exercised end-to-end by Playwright; the
// REGRESSIONS below need deterministic unit-level control (queue shapes,
// script injection, beacon ORDER), so this file drives them under node with
// hand-rolled fakes stubbed onto the globals the modules consume
// (window/document/location/Element/HTMLElement/HTMLInputElement). No DOM
// library is used (repo constraint: no new deps).
//
//   * M2 — the ENGINE injects the Google Maps SDK script itself when
//     __LG_MAPS_KEY__ + a [data-lg-maps] field exist, and re-runs
//     initMapsFields once Places is ready; key-missing = console-error-free
//     no-op (no script tag).
//   * M3 — the Places field mask requests "address_components" (plural).
//   * M4 + m7 — the inline stub's `{el, t}` queue items REPLAY after
//     hydration, and AFTER quote_view/section_view in beacon order.
//   * m12 — ZIP-format inputs STORE the trimmed value at capture.
//   * m2 — the engine adopts the session_id /lg/attempt ECHOES (the bound,
//     minted-when-absent id) for its runtime state (→ /lg/auction).
//   * M5 — updateProgress over the REAL ProgressBar preset markup updates the
//     fill/label hooks and never wipes .lg-progress-track.

// TYPECHECK PROGRAM NOTE: this file imports the DOM-lib runtime modules
// (engine/maps/render), so it belongs to tsconfig.runtime.json (lib DOM,
// checked by verify:leadgen-runtime) and is EXCLUDED from the worker
// tsconfig — exactly the split the runtime modules themselves live under.
// The REAL-preset-markup hook assertions this file's fakes mirror live in
// leadgen-components-render.test.ts (worker program: "M5: progress bar
// stamps data-lg-progress-bar…").

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LG_MAPS_CALLBACK,
  mapsSdkSrc,
  maybeInjectMapsSdk,
  parseMapsConfig,
  wireMapsFields,
  type LgMapsHooks,
} from "../src/public/leadgen/runtime/maps";
import { LgEngine } from "../src/public/leadgen/runtime/engine";
import * as render from "../src/public/leadgen/runtime/render";
import { validateValue } from "../src/public/leadgen/runtime/validation";
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

// The runtime modules take real DOM types; the fakes cross that boundary via
// one explicit cast (instanceof works because the classes ARE the stubbed
// Element/HTMLElement/HTMLInputElement globals).
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
  focusedCount = 0;
  // script-tag props (assigned by the maps loader)
  src = "";
  async = false;

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

  get className(): string {
    return [...this.classSet].join(" ");
  }

  getAttribute(name: string): string | null {
    if (name === "class") return this.className;
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

// Stub the browser globals the runtime modules consume. Every test restores
// them via vi.unstubAllGlobals() in afterEach.
function stubBrowserGlobals(win: Record<string, unknown>, doc: FakeDocument): void {
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { href: "https://one.example.com/lg/fx?utm_source=hyd", search: "?utm_source=hyd" });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// M2 + M3 — the engine-owned Maps SDK loader + the Places field mask
// ---------------------------------------------------------------------------

describe("M2/M3 — runtime/maps.ts loads the Places SDK itself (03 §3.2d / 08 §8.8)", () => {
  interface AutocompleteCall {
    input: unknown;
    opts: Record<string, unknown>;
  }

  function mapsHarness(opts: { key?: string; withField?: boolean }): {
    win: Record<string, unknown>;
    doc: FakeDocument;
    root: FakeElement;
    input: FakeInputElement;
    ctorCalls: AutocompleteCall[];
    installSdk: () => void;
    hooks: LgMapsHooks;
  } {
    const doc = fakeDocument();
    const win: Record<string, unknown> = {};
    if (opts.key !== undefined) win["__LG_MAPS_KEY__"] = opts.key;
    const root = new FakeElement("div");
    root.ownerDocument = doc;
    const input = new FakeInputElement({ "data-lg-input": "" });
    if (opts.withField !== false) {
      const field = new FakeElement("div", {
        "data-lg-maps": JSON.stringify({ enable_autocomplete: true, autofill_city: "city" }),
        "data-lg-field": "address",
      });
      field.ownerDocument = doc;
      field.appendChild(input);
      root.appendChild(field);
    }
    const ctorCalls: AutocompleteCall[] = [];
    class FakeAutocomplete {
      constructor(inputEl: unknown, ctorOpts: Record<string, unknown>) {
        ctorCalls.push({ input: inputEl, opts: ctorOpts });
      }
      addListener(): void {
        /* not exercised here */
      }
      getPlace(): null {
        return null;
      }
    }
    const installSdk = (): void => {
      win["google"] = { maps: { places: { Autocomplete: FakeAutocomplete } } };
    };
    const hooks: LgMapsHooks = { emit: () => undefined };
    stubBrowserGlobals(win, doc);
    return { win, doc, root, input, ctorCalls, installSdk, hooks };
  }

  it("M2: key + [data-lg-maps] field + no SDK → injects ONE script with the contract src shape and re-runs init on ready", () => {
    const h = mapsHarness({ key: "test-maps-key" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const wired = wireMapsFields(asEl(h.root), h.hooks);
    expect(wired).toBe(0); // SDK absent at call time — nothing wired YET

    // Exactly one script tag, marked, async, with the contract URL shape.
    const scripts = h.doc.head.children.filter((el) => el.tag === "script");
    expect(scripts.length).toBe(1);
    const script = scripts[0]!;
    expect(script.getAttribute("data-lg-maps-sdk")).toBe("1");
    expect(script.async).toBe(true);
    expect(script.src).toBe(mapsSdkSrc("test-maps-key"));
    expect(script.src).toContain("https://maps.googleapis.com/maps/api/js?key=test-maps-key");
    expect(script.src).toContain("&libraries=places");
    expect(script.src).toContain("&loading=async");
    expect(script.src).toContain(`&callback=${LG_MAPS_CALLBACK}`);

    // A second call while the script is in flight chains — never a second tag.
    expect(wireMapsFields(asEl(h.root), h.hooks)).toBe(0);
    expect(h.doc.head.children.filter((el) => el.tag === "script").length).toBe(1);

    // SDK ready → the URL callback fires → initMapsFields re-runs and wires
    // the field: the Autocomplete ctor receives the input + the M3 fields.
    h.installSdk();
    (h.win[LG_MAPS_CALLBACK] as () => void)();
    expect(h.ctorCalls.length).toBeGreaterThanOrEqual(1);
    expect(h.ctorCalls[0]!.input).toBe(h.input);
    // M3: "address_components" (plural) — "address_component" is not a valid
    // Places field and silently voids the whole autofill path.
    expect(h.ctorCalls[0]!.opts["fields"]).toEqual(["address_components", "formatted_address"]);
    expect(h.ctorCalls[0]!.opts["types"]).toEqual(["address"]);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("M2: key missing → NO script tag, no console errors (silent manual-entry no-op)", () => {
    const h = mapsHarness({ withField: true }); // no __LG_MAPS_KEY__
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(wireMapsFields(asEl(h.root), h.hooks)).toBe(0);
    expect(maybeInjectMapsSdk(asEl(h.root), () => undefined)).toBe("no_key");
    expect(h.doc.head.children.length).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("M2: key present but NO [data-lg-maps] field → no script tag", () => {
    const h = mapsHarness({ key: "test-maps-key", withField: false });
    expect(maybeInjectMapsSdk(asEl(h.root), () => undefined)).toBe("no_fields");
    expect(h.doc.head.children.length).toBe(0);
  });

  it("M2: SDK already present → onReady runs immediately, no script tag", () => {
    const h = mapsHarness({ key: "test-maps-key" });
    h.installSdk();
    let ran = 0;
    expect(
      maybeInjectMapsSdk(asEl(h.root), () => {
        ran += 1;
      }),
    ).toBe("already_loaded");
    expect(ran).toBe(1);
    expect(h.doc.head.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §8.8 studio emissions — the runtime-reader cross-check over the EXACT
// config literals the Section-Studio inspector writes into props.maps.
// The emission side (island collectors → these literals, byte-faithful into
// data-lg-maps) is pinned in test/leadgen-section-studio-ui.test.ts
// (MAPS_EMITTED_* — the worker typecheck program; runtime/maps.ts cannot be
// imported there). Keep BOTH literal sets in lockstep.
// ---------------------------------------------------------------------------

describe("§8.8 studio emissions — parseMapsConfig decodes the inspector's exact keys to the wired config", () => {
  it("address emission → full wired config (autocomplete + validate + normalize + all three fills)", () => {
    const MAPS_EMITTED_ADDRESS = {
      enable_autocomplete: true,
      validate_full_address: true,
      normalize_address_line: true,
      autofill_state: "state_field",
      autofill_city: "city",
      autofill_zip: "zip",
    };
    expect(parseMapsConfig(JSON.stringify(MAPS_EMITTED_ADDRESS))).toEqual({
      autocomplete: true,
      validate: true,
      normalize: true,
      fills: { city: "city", state: "state_field", zip: "zip" },
    });
  });

  it("zip emission → wired config: the studio-added enable_autocomplete gate makes initMapsFields attach Places", () => {
    const MAPS_EMITTED_ZIP = {
      validate_zip: true,
      autofill_city: "city",
      autofill_state: "state_field",
      enable_autocomplete: true,
    };
    expect(parseMapsConfig(JSON.stringify(MAPS_EMITTED_ZIP))).toEqual({
      autocomplete: true,
      validate: true,
      normalize: false,
      fills: { city: "city", state: "state_field" },
    });
    // WITHOUT the gate the runtime would skip the field entirely
    // (initMapsFields: `!config.autocomplete → continue`) — the reason the
    // studio's zip collector always rides enable_autocomplete along.
    const gateless = parseMapsConfig(JSON.stringify({ validate_zip: true, autofill_city: "city" }));
    expect(gateless).not.toBeNull();
    expect(gateless!.autocomplete).toBe(false);
  });

  it("zip validate-only emission + the studio's cleared state (props.maps deleted → attribute '{}' compat fallback)", () => {
    const MAPS_EMITTED_ZIP_VALIDATE_ONLY = { validate_zip: true, enable_autocomplete: true };
    expect(parseMapsConfig(JSON.stringify(MAPS_EMITTED_ZIP_VALIDATE_ONLY))).toEqual({
      autocomplete: true,
      validate: true,
      normalize: false,
      fills: {},
    });
    // a cleared node renders data-lg-maps="{}" (address compat fallback):
    // everything off — the graceful manual-entry no-op
    expect(parseMapsConfig("{}")).toEqual({ autocomplete: false, validate: false, normalize: false, fills: {} });
  });

  // R4b (S3-7) adversarial-review MINOR F2: every case above feeds parseMapsConfig
  // the FLAT autofill_* spelling only — the NESTED `fills` object branch of this
  // SAME pick() reader (runtime/maps.ts:42-58) was never exercised through the
  // real function, only through a hand-copied mirror in the worker-program R4b
  // test suites (leadgen-r4b-facet.test.ts / leadgen-r4b-maps-runtime.test.ts —
  // runtime/maps.ts is excluded from the worker tsconfig, so those suites cannot
  // import it directly). This closes that real-reader coverage gap for the
  // nested branch: mapsConfigJson (presets.ts) emits fills NESTED (never the
  // flat autofill_* spelling), so THIS is the shape the wire actually carries.
  it("R4b S3-7: parseMapsConfig decodes the NESTED fills object (the shape mapsConfigJson actually emits)", () => {
    const wired = parseMapsConfig(JSON.stringify({ enable_autocomplete: true, fills: { city: "city_field" } }));
    expect(wired).not.toBeNull();
    expect(wired!.fills.city).toBe("city_field");
  });
});

// ---------------------------------------------------------------------------
// Engine harness (M4/m7, m12, m2)
// ---------------------------------------------------------------------------

interface EngineHarness {
  win: Record<string, unknown>;
  doc: FakeDocument;
  root: FakeElement;
  sectionEl: FakeElement;
  questionEl: FakeElement;
  choiceYes: FakeElement;
  previewBatches: Array<Array<Record<string, unknown>>>;
  engineApi: () => {
    getState: () => { session_id: string; funnel_attempt_id: string };
    getAnswers: () => Record<string, unknown>;
  };
}

function engineConfig(components: LgComponentConfig[]): LgPublicConfig {
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
    sections: [
      {
        section_public_id: "lgs_1",
        section_index: 0,
        headline: "H",
        continue_mode: "button",
        address_validation_enabled: false,
        section_mapping_version: 0,
        answer_mapping_version: "0",
        components,
      },
    ],
  };
}

function buildEngineDom(doc: FakeDocument): Pick<EngineHarness, "root" | "sectionEl" | "questionEl" | "choiceYes"> & {
  zipInput: FakeInputElement;
} {
  const root = new FakeElement("div", { id: "lg-funnel-root" });
  root.ownerDocument = doc;
  const mount = new FakeElement("main", { "data-lg-mount": "" });
  const sectionEl = new FakeElement("section", {
    "data-lg-section": "",
    "data-lg-section-id": "lgs_1",
    "data-lg-index": "0",
  });
  const questionEl = new FakeElement("div", { "data-lg-question": "q1", "data-lg-field": "f1" });
  const choiceYes = new FakeElement("button", { "data-lg-choice": "yes" });
  const choiceNo = new FakeElement("button", { "data-lg-choice": "no" });
  const zipQuestion = new FakeElement("div", { "data-lg-question": "qz", "data-lg-field": "zip" });
  const zipInput = new FakeInputElement({ "data-lg-input": "" });
  for (const el of [root, mount, sectionEl, questionEl, choiceYes, choiceNo, zipQuestion, zipInput]) {
    el.ownerDocument = doc;
  }
  questionEl.appendChild(choiceYes);
  questionEl.appendChild(choiceNo);
  zipQuestion.appendChild(zipInput);
  sectionEl.appendChild(questionEl);
  sectionEl.appendChild(zipQuestion);
  mount.appendChild(sectionEl);
  root.appendChild(mount);
  return { root, sectionEl, questionEl, choiceYes, zipInput };
}

const ENGINE_COMPONENTS: LgComponentConfig[] = [
  {
    type: "TwoButtonYesNo",
    question_id: "q1",
    question_key: "k1",
    internal_field: "f1",
    props: {},
    choices: [
      { label: "Yes", value: "yes", analytics_id: "a_yes" },
      { label: "No", value: "no", analytics_id: "a_no" },
    ],
  },
  {
    type: "ZIPInputQuestion",
    question_id: "qz",
    question_key: "kz",
    internal_field: "zip",
    props: {},
  },
];

async function bootEngine(opts: {
  preview: boolean;
  // Builds the pre-hydration queue FROM the built DOM (the inline stub queues
  // the very elements it saw), before the engine initializes.
  prehydrateQueue?: (dom: ReturnType<typeof buildEngineDom>) => unknown[];
  fetchMock?: (url: string) => Response | null;
}): Promise<EngineHarness & { zipInput: FakeInputElement }> {
  const doc = fakeDocument();
  const previewBatches: Array<Array<Record<string, unknown>>> = [];
  const win: Record<string, unknown> = {
    sessionStorage: fakeSessionStorage(),
    parent: {
      postMessage: (msg: { type?: string; events?: Array<Record<string, unknown>> }) => {
        if (msg?.type === "lg-preview-event") previewBatches.push(msg.events ?? []);
      },
    },
  };
  const dom = buildEngineDom(doc);
  if (opts.prehydrateQueue !== undefined) win["__LG_PREHYDRATE_QUEUE__"] = opts.prehydrateQueue(dom);
  stubBrowserGlobals(win, doc);
  if (opts.fetchMock !== undefined) {
    const mock = opts.fetchMock;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      return mock(url) ?? new Response(null, { status: 204 });
    });
  }

  const engine = new LgEngine(
    dom.root as unknown as HTMLElement,
    engineConfig(ENGINE_COMPONENTS),
    opts.preview,
  );
  await engine.init();

  return {
    win,
    doc,
    ...dom,
    previewBatches,
    engineApi: () =>
      win["__LG_ENGINE__"] as {
        getState: () => { session_id: string; funnel_attempt_id: string };
        getAnswers: () => Record<string, unknown>;
      },
  };
}

// ---------------------------------------------------------------------------
// M4 + m7 — the pre-hydration queue replays `{el, t}` items AFTER the views
// ---------------------------------------------------------------------------

describe("M4/m7 — prehydrate queue replay (03 §3.2 stub / §3.5.1 ordering)", () => {
  it("a queue shaped EXACTLY as the stub produces ({el, t}) replays the click post-init, sequenced AFTER quote_view + section_view", async () => {
    vi.useFakeTimers();
    // The exact serve.ts LEADGEN_PREHYDRATE_JS shape: q.push({el:el,t:Date.now()})
    const h = await bootEngine({
      preview: true,
      prehydrateQueue: (dom) => [{ el: dom.choiceYes, t: 12345 }],
    });

    // The replayed click APPLIED: state + selection class + queue drained.
    expect(h.engineApi().getAnswers()["f1"]).toBe("yes");
    expect(h.choiceYes.classSet.has("lg-selected")).toBe(true);
    expect((h.win["__LG_PREHYDRATE_QUEUE__"] as unknown[]).length).toBe(0);

    // Beacon ORDER (m7): flush the micro-batch window; the one batch carries
    // quote_view → section_view → answer_click, in that order.
    vi.advanceTimersByTime(1000);
    const events = h.previewBatches.flat();
    const types = events.map((e) => e["event_type"]);
    expect(types).toContain("answer_click");
    const quoteViewIdx = types.indexOf("quote_view");
    const sectionViewIdx = types.indexOf("section_view");
    const answerClickIdx = types.indexOf("answer_click");
    expect(quoteViewIdx).toBeGreaterThanOrEqual(0);
    expect(sectionViewIdx).toBeGreaterThan(quoteViewIdx);
    expect(answerClickIdx, "a replayed answer_click sequences AFTER quote_view").toBeGreaterThan(quoteViewIdx);
    expect(answerClickIdx, "a replayed answer_click sequences AFTER section_view").toBeGreaterThan(sectionViewIdx);
    const click = events[answerClickIdx]!;
    expect(click["internal_field"]).toBe("f1");
    expect(click["answer_value_normalized"]).toBe("yes");
    expect(click["answer_source"]).toBe("user_selected");
  });

  it("string and Element queue items stay tolerated (back-compat)", async () => {
    vi.useFakeTimers();
    // A bare Element item (the legacy tolerated shape).
    const h = await bootEngine({
      preview: true,
      prehydrateQueue: (dom) => [dom.choiceYes],
    });
    expect(h.engineApi().getAnswers()["f1"]).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// m12 — ZIP-format inputs store the TRIMMED value at capture
// ---------------------------------------------------------------------------

describe("m12 — ZIP whitespace trim at capture (runtime state write)", () => {
  it('" 90210" stores "90210" and passes BOTH client validation and the server /^\\d{5}$/', async () => {
    vi.useFakeTimers();
    const h = await bootEngine({ preview: true });

    h.zipInput.value = " 90210";
    h.root.dispatch("input", h.zipInput);

    const stored = h.engineApi().getAnswers()["zip"];
    expect(stored).toBe("90210");
    // Client validation (unchanged semantics) passes on the stored value…
    const zipComponent = ENGINE_COMPONENTS[1]!;
    expect(validateValue(zipComponent, stored, true)).toEqual([]);
    // …and the STORED value now also passes the server's strict ZIP_RE
    // (leadgen/maps.ts /^\d{5}$/) — the pre-fix " 90210" did not.
    expect(/^\d{5}$/.test(String(stored))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// m2 — the engine adopts the session_id /lg/attempt echoes
// ---------------------------------------------------------------------------

describe("m2 — the engine uses the BOUND session_id /lg/attempt echoes (cookie-blocked visitors)", () => {
  it("runtime state (→ /lg/auction session_id) carries EXACTLY the echoed value, not the client-minted one", async () => {
    vi.useFakeTimers();
    const h = await bootEngine({
      preview: false,
      fetchMock: (url) => {
        if (url.includes("/lg/attempt")) {
          return new Response(
            JSON.stringify({
              funnel_attempt_id: "att_ECHO0001",
              signed_config_token: "v2.payload.sig",
              session_id: "srv-bound-sid",
            }),
            { status: 200 },
          );
        }
        return null; // /lg/track etc → 204
      },
    });

    const state = h.engineApi().getState();
    expect(state.funnel_attempt_id).toBe("att_ECHO0001");
    // The engine minted a LOCAL sid first (cookie write may be blocked); the
    // server's echoed BOUND sid must win — /lg/auction posts state.session_id.
    expect(state.session_id).toBe("srv-bound-sid");
  });

  it("no echo (legacy response) → the client-resolved sid stays (back-compat)", async () => {
    vi.useFakeTimers();
    const h = await bootEngine({
      preview: false,
      fetchMock: (url) => {
        if (url.includes("/lg/attempt")) {
          return new Response(
            JSON.stringify({ funnel_attempt_id: "att_LEGACY01", signed_config_token: "v2.p.s" }),
            { status: 200 },
          );
        }
        return null;
      },
    });
    const state = h.engineApi().getState();
    expect(state.funnel_attempt_id).toBe("att_LEGACY01");
    expect(state.session_id).not.toBe(""); // the locally-resolved ko_sid value
  });
});

// ---------------------------------------------------------------------------
// M5 — updateProgress over the REAL ProgressBar preset markup
// ---------------------------------------------------------------------------

describe("M5 — hydration updates the ProgressBar via hooks, never wipes the track (09 §9.1)", () => {
  // The REAL preset markup's hook/class strings are asserted in
  // leadgen-components-render.test.ts (worker program) — the fake tree below
  // mirrors exactly that asserted structure:
  //   [data-lg-progress data-mode] > .lg-progress-track >
  //     .lg-progress-fill[data-lg-progress-bar]
  //   + .lg-progress-text[data-lg-progress-label]
  it("updateProgress writes the fill width + label text and preserves .lg-progress-track (no textContent wipe)", () => {
    const doc = fakeDocument();
    stubBrowserGlobals({ sessionStorage: fakeSessionStorage() }, doc);
    // Mirror of the preset structure asserted above.
    const root = new FakeElement("div");
    const progress = new FakeElement("div", { "data-lg-progress": "", "data-mode": "step" });
    const track = new FakeElement("div", { class: "lg-progress-track" });
    const fill = new FakeElement("div", { class: "lg-progress-fill", "data-lg-progress-bar": "" });
    const label = new FakeElement("div", { class: "lg-progress-text", "data-lg-progress-label": "" });
    label.textContent = "Step 1 of 4";
    track.appendChild(fill);
    progress.appendChild(track);
    progress.appendChild(label);
    root.appendChild(progress);

    render.updateProgress(root as unknown as Element, 2, 4);

    // Hook-targeted updates…
    expect(fill.style["width"]).toBe("50%");
    expect(label.textContent).toBe("2 / 4");
    // …and the structure SURVIVES: the track + fill are still children — the
    // pre-fix fallback replaced the whole subtree with textContent "2 / 4".
    expect(progress.children.length).toBe(2);
    expect(track.children[0]).toBe(fill);
    expect(progress.textContent).toBe(""); // never written on the hook path
    expect(progress.getAttribute("aria-valuenow")).toBe("2");
    expect(progress.getAttribute("aria-valuemax")).toBe("4");
  });

  it("legacy hook-less markup keeps the textContent fallback", () => {
    const doc = fakeDocument();
    stubBrowserGlobals({ sessionStorage: fakeSessionStorage() }, doc);
    const root = new FakeElement("div");
    const progress = new FakeElement("div", { "data-lg-progress": "", "data-mode": "step" });
    root.appendChild(progress);
    render.updateProgress(root as unknown as Element, 3, 5);
    expect(progress.textContent).toBe("3 / 5");
  });
});
