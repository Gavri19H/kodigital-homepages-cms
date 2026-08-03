// LeadGen P8 defect contract — B1 (fill leg): a chosen Google suggestion must
// fill the VISIBLE inputs, and must never stamp an answer the visitor cannot
// see.
//
// GROUND DEFECT (driven by the P8-1 reviewer at 43e7219): runtime/maps.ts's
// place_changed handler called `hooks.setAnswer(target, value, …)` and NOTHING
// ever wrote the value into the DOM input. On the owner's own scenario
// (street+city autofill, ZIP manual) the store held city="Mountain View" while
// the visible City box still showed its grey placeholder; on the D3 default the
// store carried Google's 94043 for a ZIP box the visitor saw empty — an answer
// they never gave, cannot see, cannot correct, and which is what the buyer
// receives.
//
// THE FIX UNDER TEST: the handler fills the target's VISIBLE input and
// dispatches the real bubbling `change` event the engine's own delegated
// listener already owns (engine.bindListeners → handleInputEvent reads the
// value straight off the element). A target with no rendered input is filled
// NOWHERE — no box, no answer.
//
// E10/E11 — BOTH sides are real here:
//   * producer: the REAL renderComponent (presets.ts) emits the markup, parsed
//     verbatim into the fake DOM below (no hand-authored attributes);
//   * consumer: the REAL runtime/maps.ts initMapsFields + its REAL
//     place_changed handler, fed a REAL-SHAPED Google PlaceResult
//     (address_components, long_name/short_name/types).
// The only hand-built piece is the DOM itself (the repo forbids new deps, so
// jsdom is unavailable — the same constraint test/leadgen-runtime-hydration.
// test.ts records) plus a listener that models ONLY engine.bindListeners'
// registration and handleInputEvent's DOM READ (root-level `change`, internal
// field from closest("[data-lg-field]"), value off the element) — never any
// maps.ts logic.
//
// IMPORT NOTE: runtime/maps.ts is a BROWSER module (lib DOM) that the worker
// tsconfig excludes; a STATIC import pulls it into `tsc --noEmit` under the
// DOM-less worker lib and fails (confirmed in leadgen-p8-b1-maps-shape.test.ts).
// The specifier below is assembled at runtime, so the module never enters the
// worker program (`npm run typecheck` clean) while vitest still loads the REAL
// file — strictly better than mirroring the code under test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const MAPS_SPEC = ["..", "src", "public", "leadgen", "runtime", "maps"].join("/");

interface RealMaps {
  initMapsFields: (root: unknown, hooks: unknown) => number;
}

async function loadRealMaps(): Promise<RealMaps> {
  return (await import(/* @vite-ignore */ MAPS_SPEC)) as unknown as RealMaps;
}

// ---------------------------------------------------------------------------
// Minimal DOM over the REAL rendered markup
// ---------------------------------------------------------------------------

function unescapeAttr(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type Listener = (ev: Event) => void;

class FakeElement {
  tag: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  listeners = new Map<string, Array<{ fn: Listener; capture: boolean }>>();

  constructor(tag: string) {
    this.tag = tag;
  }

  getAttribute(name: string): string | null {
    const v = this.attrs.get(name);
    return v === undefined ? null : v;
  }

  appendChild(child: FakeElement): void {
    child.parentElement = this;
    this.children.push(child);
  }

  remove(): void {
    const parent = this.parentElement;
    if (parent === null) return;
    parent.children = parent.children.filter((c) => c !== this);
    this.parentElement = null;
  }

  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      out.push(child, ...child.descendants());
    }
    return out;
  }

  matches(selector: string): boolean {
    const sel = selector.trim();
    if (sel.startsWith(".")) {
      return (this.getAttribute("class") ?? "").split(/\s+/).includes(sel.slice(1));
    }
    const attr = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (attr !== null) {
      const name = attr[1] ?? "";
      if (attr[2] === undefined) return this.attrs.has(name);
      return this.getAttribute(name) === attr[2];
    }
    return this.tag === sel;
  }

  private matchesCompound(selector: string): boolean {
    // "[a] [b]" — the LAST token matches this element, an ANCESTOR the first.
    const parts = selector.trim().split(/\s+(?![^[]*\])/);
    const last = parts[parts.length - 1] ?? "";
    if (!this.matches(last)) return false;
    for (let i = parts.length - 2; i >= 0; i--) {
      let cur = this.parentElement;
      let hit = false;
      while (cur !== null) {
        if (cur.matches(parts[i] ?? "")) {
          hit = true;
          break;
        }
        cur = cur.parentElement;
      }
      if (!hit) return false;
    }
    return true;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => el.matchesCompound(selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this;
    while (cur !== null) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  addEventListener(type: string, fn: Listener, capture = false): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) this.listeners.set(type, [{ fn, capture }]);
    else existing.push({ fn, capture });
  }

  private fire(node: FakeElement, ev: Event, capture: boolean): void {
    for (const l of node.listeners.get(ev.type) ?? []) {
      if (l.capture === capture) l.fn(ev);
    }
  }

  // Real capture→target→bubble propagation over the ancestor path, with the
  // capture flag honoured exactly as the browser does (a capture-registered
  // ancestor listener fires ONCE, on the way down) — so a root-level
  // registration (how engine.bindListeners registers `input` bubbling and
  // `change` capturing) receives an event dispatched on a descendant input
  // exactly as it would live.
  dispatchEvent(ev: Event): boolean {
    Object.defineProperty(ev, "target", { value: this, configurable: true });
    const path: FakeElement[] = [];
    let cur: FakeElement | null = this;
    while (cur !== null) {
      path.push(cur);
      cur = cur.parentElement;
    }
    for (const node of [...path].reverse().slice(0, -1)) this.fire(node, ev, true);
    this.fire(this, ev, true);
    this.fire(this, ev, false);
    if (ev.bubbles) {
      for (const node of path.slice(1)) this.fire(node, ev, false);
    }
    return true;
  }
}

class FakeInputElement extends FakeElement {
  value = "";
}

const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);

// Parse the REAL rendered HTML string into the element tree above (elements +
// attributes only — no assertion below reads text).
function parseHtml(html: string): FakeElement {
  const root = new FakeElement("div");
  root.attrs.set("data-lg-root", "");
  let cursor: FakeElement = root;
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g;
  for (const m of html.matchAll(tagPattern)) {
    const tag = (m[2] ?? "").toLowerCase();
    if (m[1] === "/") {
      if (cursor.parentElement !== null) cursor = cursor.parentElement;
      continue;
    }
    const el = tag === "input" ? new FakeInputElement(tag) : new FakeElement(tag);
    for (const a of (m[3] ?? "").matchAll(attrPattern)) {
      el.attrs.set(a[1] ?? "", a[2] === undefined ? "" : unescapeAttr(a[2]));
    }
    if (el instanceof FakeInputElement) el.value = el.getAttribute("value") ?? "";
    cursor.appendChild(el);
    if (!VOID_TAGS.has(tag) && m[4] !== "/") cursor = el;
  }
  return root;
}

// ---------------------------------------------------------------------------
// The REAL-shaped Google PlaceResult (1600 Amphitheatre Pkwy — the reviewer's
// own scenario payload).
// ---------------------------------------------------------------------------

const PLACE = {
  address_components: [
    { long_name: "1600", short_name: "1600", types: ["street_number"] },
    { long_name: "Amphitheatre Parkway", short_name: "Amphitheatre Pkwy", types: ["route"] },
    { long_name: "Mountain View", short_name: "Mountain View", types: ["locality", "political"] },
    { long_name: "Santa Clara County", short_name: "Santa Clara County", types: ["administrative_area_level_2", "political"] },
    { long_name: "California", short_name: "CA", types: ["administrative_area_level_1", "political"] },
    { long_name: "United States", short_name: "US", types: ["country", "political"] },
    { long_name: "94043", short_name: "94043", types: ["postal_code"] },
  ],
  formatted_address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
};

// extractAddressParts' own derivation (street_number + " " + route, LONG
// names) — deliberately NOT PLACE.formatted_address, which also carries
// city/state/zip (and abbreviates "Parkway" to "Pkwy"). P8 F4: this is what
// a composite's STREET box must hold — never the whole formatted string.
const STREET_LINE = "1600 Amphitheatre Parkway";

function addressNode(props: Record<string, unknown>): LeadgenComponentNode {
  return {
    type: "AddressAutocompleteQuestion",
    question_id: "q_addr",
    internal_field: "addr",
    props,
  } as LeadgenComponentNode;
}

interface Harness {
  root: FakeElement;
  // What a root-level `change` listener sees — the engine's DOM read.
  recorded: Array<{ field: string; value: string }>;
  // The DELETED store-only path: nothing may reach it.
  setAnswerCalls: Array<{ field: string; value: unknown }>;
  emitted: Array<{ type: string; fields: Record<string, unknown> }>;
  wired: number;
  firePlaceChanged: () => void;
  inputValue: (field: string) => string | null;
}

async function driveRealAutocomplete(
  props: Record<string, unknown>,
  mutate?: (root: FakeElement) => void,
): Promise<Harness> {
  const html = renderComponent(addressNode(props), defaultFunnelDesign);
  const root = parseHtml(html);
  if (mutate !== undefined) mutate(root);

  const recorded: Array<{ field: string; value: string }> = [];
  // Models ONLY engine.bindListeners' registration — `this.root.addEventListener
  // ("change", onInput, true)`, verbatim capture flag — plus handleInputEvent's
  // first reads (`closest("[data-lg-field]")`, the value off the element).
  root.addEventListener(
    "change",
    (ev) => {
      const el = (ev as unknown as { target: FakeElement }).target;
      const field = el.closest("[data-lg-field]")?.getAttribute("data-lg-field") ?? "";
      recorded.push({ field, value: el instanceof FakeInputElement ? el.value : "" });
    },
    true,
  );

  const listeners: Array<() => void> = [];
  class FakeAutocomplete {
    inputEl: FakeElement;
    constructor(inputEl: FakeElement, _opts: Record<string, unknown>) {
      this.inputEl = inputEl;
    }
    addListener(_event: string, handler: () => void): void {
      listeners.push(handler);
    }
    getPlace(): typeof PLACE {
      // Places writes its own text into the field it owns BEFORE firing
      // place_changed — exactly like the live widget.
      if (this.inputEl instanceof FakeInputElement) this.inputEl.value = PLACE.formatted_address;
      return PLACE;
    }
  }
  vi.stubGlobal("window", { google: { maps: { places: { Autocomplete: FakeAutocomplete } } } });
  vi.stubGlobal("HTMLInputElement", FakeInputElement);

  const setAnswerCalls: Array<{ field: string; value: unknown }> = [];
  const emitted: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const maps = await loadRealMaps();
  const wired = maps.initMapsFields(root, {
    setAnswer: (field: string, value: unknown) => setAnswerCalls.push({ field, value }),
    emit: (type: string, fields: Record<string, unknown>) => emitted.push({ type, fields }),
  });

  return {
    root,
    recorded,
    setAnswerCalls,
    emitted,
    wired,
    firePlaceChanged: () => {
      for (const fn of listeners) fn();
    },
    inputValue: (field: string) => {
      const el = root.querySelector(`[data-lg-field="${field}"] [data-lg-input]`);
      return el instanceof FakeInputElement ? el.value : null;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("P8 B1 — a chosen suggestion fills the VISIBLE inputs (never a store-only stamp)", () => {
  it("(a) D3 default: the mapped city/state/zip BOXES carry Google's values, and every recorded write equals what is on screen", async () => {
    const h = await driveRealAutocomplete({});
    expect(h.wired, "the D3 default wires exactly one Places field").toBe(1);
    expect(h.inputValue("addr_city")).toBe("");
    expect(h.inputValue("addr_state")).toBe("");
    expect(h.inputValue("addr_zip")).toBe("");

    h.firePlaceChanged();

    // Fail-before: all three stayed "" while the store already held them.
    // P8 F4: the street box holds ONLY the street line — never the full
    // formatted address (which duplicates city/state/zip into a box the
    // visitor sees labelled "Street address", right next to the siblings
    // below that already carry those same parts correctly).
    expect(h.inputValue("addr_street")).toBe(STREET_LINE);
    expect(h.inputValue("addr_city")).toBe("Mountain View");
    expect(h.inputValue("addr_state")).toBe("CA");
    expect(h.inputValue("addr_zip")).toBe("94043");

    // The engine's own path saw every one of them, and what it read off the
    // DOM IS what the visitor is looking at (store == screen, by construction).
    expect(h.recorded.map((r) => r.field)).toEqual([
      "addr_street",
      "addr_city",
      "addr_state",
      "addr_zip",
    ]);
    for (const r of h.recorded) expect(r.value).toBe(h.inputValue(r.field));

    // The deleted store-only path is never used again.
    expect(h.setAnswerCalls).toEqual([]);
  });

  it("(b) owner's scenario (street+city autofill, ZIP manual): the ZIP box stays the visitor's and is recorded NOWHERE", async () => {
    const h = await driveRealAutocomplete({
      maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } },
      fields: [
        { field: "street", mode: "autofill" },
        { field: "city", mode: "autofill" },
        { field: "zip", mode: "manual" },
      ],
    });
    expect(h.wired).toBe(1);

    h.firePlaceChanged();

    // P8 F4: this 3-field composite (street+city autofill, zip manual) is
    // STILL a composite — the street box holds ONLY the street line.
    expect(h.inputValue("addr_street")).toBe(STREET_LINE);
    expect(h.inputValue("addr_city")).toBe("Mountain View");
    // The manual field: empty on screen ⇒ empty everywhere. Fail-before it was
    // empty on screen too — but the store already carried Google's 94043.
    expect(h.inputValue("addr_zip")).toBe("");
    expect(h.recorded.map((r) => r.field)).toEqual(["addr_street", "addr_city"]);
    expect(h.recorded.some((r) => r.field === "addr_zip")).toBe(false);
    expect(h.setAnswerCalls).toEqual([]);

    // …and the visitor's own ZIP still wins, through the same door.
    const zip = h.root.querySelector('[data-lg-field="addr_zip"] [data-lg-input]');
    expect(zip).toBeInstanceOf(FakeInputElement);
    (zip as FakeInputElement).value = "94044";
    (zip as FakeInputElement).dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.recorded[h.recorded.length - 1]).toEqual({ field: "addr_zip", value: "94044" });
  });

  it("(c) a mapped target with NO rendered input is filled NOWHERE — no invisible answer, and the beacon does not claim it", async () => {
    // The city field is mapped (D3 default) but not on screen: the exact class
    // the money-path defect lived in — a value the visitor can neither see nor
    // correct, stamped as their own.
    const h = await driveRealAutocomplete({}, (root) => {
      root.querySelector('[data-lg-field="addr_city"]')?.remove();
    });
    expect(h.inputValue("addr_city")).toBeNull(); // genuinely absent from the DOM

    h.firePlaceChanged();

    expect(h.recorded.map((r) => r.field)).toEqual(["addr_street", "addr_state", "addr_zip"]);
    expect(h.setAnswerCalls).toEqual([]); // fail-before: [{field:"addr_city", value:"Mountain View"}, …]
    const autofill = h.emitted.find((e) => e.type === "address_autofill");
    expect(autofill).toBeDefined();
    expect(autofill?.fields["answer_value_normalized"]).toBe("addr_state,addr_zip");
  });

  it("(d) the visible box and the recorded value never diverge across a re-selection", async () => {
    const h = await driveRealAutocomplete({});
    h.firePlaceChanged();
    // The visitor corrects the city by hand, then picks a suggestion again.
    const city = h.root.querySelector('[data-lg-field="addr_city"] [data-lg-input]') as FakeInputElement;
    city.value = "Palo Alto";
    city.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.recorded[h.recorded.length - 1]).toEqual({ field: "addr_city", value: "Palo Alto" });

    h.firePlaceChanged();
    expect(h.inputValue("addr_city")).toBe("Mountain View");
    for (const r of h.recorded) {
      if (r.field !== "addr_city") continue;
      // every recorded city value was, at that moment, the box's own text
      expect(["Mountain View", "Palo Alto"]).toContain(r.value);
    }
    expect(h.recorded[h.recorded.length - 1]?.field).toBe("addr_zip");
    expect(h.setAnswerCalls).toEqual([]);
  });

  it("(e) P8 F4 — multi-field composite: the STREET box holds ONLY the street line, never duplicated city/state/zip (fails pre-fix)", async () => {
    const h = await driveRealAutocomplete({});
    expect(h.wired).toBe(1);

    h.firePlaceChanged();

    // The anchor (street) box: street_number + route ONLY.
    expect(h.inputValue("addr_street")).toBe(STREET_LINE);
    expect(h.inputValue("addr_street")).not.toContain("Mountain View");
    expect(h.inputValue("addr_street")).not.toContain("94043");
    // Siblings keep their OWN parts, unaffected by the anchor fix.
    expect(h.inputValue("addr_city")).toBe("Mountain View");
    expect(h.inputValue("addr_state")).toBe("CA");
    expect(h.inputValue("addr_zip")).toBe("94043");
    // (c) store == screen for every recorded box.
    for (const r of h.recorded) expect(r.value).toBe(h.inputValue(r.field));
    expect(h.setAnswerCalls).toEqual([]);
  });

  it("(f) single-field full_address composite: the ONE box still receives the full formatted address (owner's other PERFECT-graded scenario — untouched)", async () => {
    const h = await driveRealAutocomplete({
      maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } },
      fields: [{ field: "full_address" }],
    });
    expect(h.wired).toBe(1);
    expect(h.inputValue("addr")).toBe("");

    h.firePlaceChanged();

    expect(h.inputValue("addr")).toBe(PLACE.formatted_address);
    expect(h.recorded).toEqual([{ field: "addr", value: PLACE.formatted_address }]);
    // (c) store == screen for the one box.
    for (const r of h.recorded) expect(r.value).toBe(h.inputValue(r.field));
    expect(h.setAnswerCalls).toEqual([]);
  });

  it("(g) P8-1 H2: a lone full_address authored mode:manual is wired to Places NOWHERE, even when the node's own Maps job is on (the Mode control now actually controls autocomplete)", async () => {
    const h = await driveRealAutocomplete({
      maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } },
      fields: [{ field: "full_address", mode: "manual" }],
    });
    // Fail-before: the lone branch ignored `mode` and read only the node's
    // Maps job, so this authored-manual field still wired (h.wired === 1).
    expect(h.wired, "manual mode: initMapsFields' [data-lg-maps] query finds nothing to wire").toBe(0);
    expect(h.inputValue("addr")).toBe("");

    h.firePlaceChanged(); // no listener was ever registered — a no-op, not a throw

    expect(h.inputValue("addr")).toBe("");
    expect(h.recorded).toEqual([]);
    expect(h.setAnswerCalls).toEqual([]);
  });
});
