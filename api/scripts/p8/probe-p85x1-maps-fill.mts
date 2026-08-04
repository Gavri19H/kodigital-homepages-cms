// P8-5 slice X1 — the DOWNSTREAM family of the declined `fills` rename, driven.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1).
//
// The X1 producer fix rewrites the COMPILED config's props.maps.fills. The open
// question the W1 slice left UNVERIFIED is the OTHER consumer of the same
// authored object: a Google Places autofill. `runtime/maps.ts fillTarget`
// resolves `[data-lg-field="<target>"] [data-lg-input]`, so if its target were
// the declined fill name it would write Google's ZIP into the SIBLING'S box.
//
// This drives it. No hand-built markup and no hand-built config:
//   * producer — the REAL presets.renderSectionComponents over the SAME defect
//     fixture (Address `l1_addr`, props.maps.fills={"zip":"pcx"}, sibling
//     FreeTextQuestion whose internal_field IS "pcx");
//   * wire     — the REAL data-lg-maps attribute read off that markup, through
//     the REAL runtime/maps.parseMapsConfig;
//   * consumer — the REAL runtime/maps.initMapsFields + its REAL place_changed
//     handler, fed a REAL-SHAPED Google PlaceResult.
// The one hand-built piece is the DOM (the repo forbids new deps, so jsdom is
// unavailable) — the same minimal element tree test/leadgen-p8-b1-fill.test.ts
// already parses the real markup into, reused here verbatim in shape.
//
// Usage: npx tsx scripts/p8/probe-p85x1-maps-fill.mts

import { renderSectionComponents } from "../../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../../src/public/leadgen/designs/default-funnel/tokens";

const MAPS_SPEC = ["..", "..", "src", "public", "leadgen", "runtime", "maps"].join("/");

// ---------------------------------------------------------------------------
// Minimal DOM over the REAL rendered markup (shape copied from
// test/leadgen-p8-b1-fill.test.ts — attributes + tree only).
// ---------------------------------------------------------------------------

function unescapeAttr(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

class FakeElement {
  tag: string;
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  listeners = new Map<string, Array<(ev: unknown) => void>>();

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

  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) out.push(child, ...child.descendants());
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

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) this.listeners.set(type, [fn]);
    else existing.push(fn);
  }

  dispatchEvent(_ev: unknown): boolean {
    return true;
  }
}

class FakeInputElement extends FakeElement {
  value = "";
}

const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);

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

// The REAL-shaped Google PlaceResult (1600 Amphitheatre Pkwy).
const PLACE = {
  address_components: [
    { long_name: "1600", short_name: "1600", types: ["street_number"] },
    { long_name: "Amphitheatre Parkway", short_name: "Amphitheatre Pkwy", types: ["route"] },
    { long_name: "Mountain View", short_name: "Mountain View", types: ["locality", "political"] },
    { long_name: "California", short_name: "CA", types: ["administrative_area_level_1", "political"] },
    { long_name: "United States", short_name: "US", types: ["country", "political"] },
    { long_name: "94043", short_name: "94043", types: ["postal_code"] },
  ],
  formatted_address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
};

const ADDRESS = {
  type: "AddressAutocompleteQuestion",
  question_id: "l1_addr",
  internal_field: "l1_addr",
  props: {
    fields: [
      { field: "street", mode: "autofill", required: false },
      { field: "zip", mode: "autofill", validation: "zip5", required: true },
    ],
    maps: { enabled: true, autocomplete: true, fills: { zip: "pcx" } },
  },
};
const SIBLING = {
  type: "FreeTextQuestion",
  question_id: "q_pcx",
  internal_field: "pcx",
  answer_type: "text",
  props: {},
};

interface RealMaps {
  parseMapsConfig: (raw: string | null) => { fills: Record<string, string | undefined> } | null;
  initMapsFields: (root: unknown, hooks: unknown) => number;
}
const maps = (await import(/* @vite-ignore */ MAPS_SPEC)) as unknown as RealMaps;

async function drive(label: string, nodes: unknown[]): Promise<void> {
  const html = renderSectionComponents(nodes as never, defaultFunnelDesign as never, {
    continue_mode: "button",
  } as never);
  const root = parseHtml(html);

  const wireEl = root.querySelector("[data-lg-maps]");
  const wireRaw = wireEl === null ? null : wireEl.getAttribute("data-lg-maps");
  const wire = maps.parseMapsConfig(wireRaw);

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
      if (this.inputEl instanceof FakeInputElement) this.inputEl.value = PLACE.formatted_address;
      return PLACE;
    }
  }
  const g = globalThis as unknown as Record<string, unknown>;
  g["window"] = { google: { maps: { places: { Autocomplete: FakeAutocomplete } } } };
  g["HTMLInputElement"] = FakeInputElement;
  g["Event"] = class {
    type: string;
    bubbles: boolean;
    constructor(type: string, init?: { bubbles?: boolean }) {
      this.type = type;
      this.bubbles = init?.bubbles === true;
    }
  };

  const emitted: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const wired = maps.initMapsFields(root, {
    setAnswer: () => undefined,
    emit: (type: string, fields: Record<string, unknown>) => emitted.push({ type, fields }),
  });

  const boxValue = (field: string): string | null => {
    const el = root.querySelector(`[data-lg-field="${field}"] [data-lg-input]`);
    if (el instanceof FakeInputElement) return el.value;
    const self = root.querySelector(`[data-lg-field="${field}"]`);
    return self instanceof FakeInputElement ? self.value : null;
  };

  const keys: string[] = [];
  for (const el of root.querySelectorAll("[data-lg-field]")) {
    const k = el.getAttribute("data-lg-field");
    if (k !== null && k !== "" && !keys.includes(k)) keys.push(k);
  }

  console.log(`\n=== ${label}`);
  console.log(`  rendered [data-lg-field] : ${JSON.stringify(keys)}`);
  console.log(`  wire data-lg-maps        : ${JSON.stringify(wireRaw)}`);
  console.log(`  parseMapsConfig().fills  : ${JSON.stringify(wire?.fills)}`);
  console.log(`  fields wired             : ${wired}`);
  for (const k of keys) console.log(`  BEFORE box[${k}]          = ${JSON.stringify(boxValue(k))}`);
  for (const fn of listeners) fn();
  for (const k of keys) console.log(`  AFTER  box[${k}]          = ${JSON.stringify(boxValue(k))}`);
  console.log(`  emitted                  : ${JSON.stringify(emitted)}`);
}

await drive("COLLISION — sibling FreeText already answers 'pcx'", [ADDRESS, SIBLING]);
await drive("CONTROL — no sibling: the 'pcx' rename is legal", [ADDRESS]);
