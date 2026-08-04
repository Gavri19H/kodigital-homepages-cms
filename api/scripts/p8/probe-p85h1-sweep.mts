// P8-5 FIX-FIRST round 2, slice H1 — the "can an operator still reach TWO
// visible inputs on ONE answer key?" sweep.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1).
//
// Every shape below is authorable through the Studio (Address rows, the Maps
// fills picker, a sibling question's own internal_field, a NameFieldsGroup's
// part names). Each is rendered by the REAL renderSectionComponents — the same
// function the served content_html comes from — and its input-bearing
// data-lg-field keys are counted.
//
// Usage: npx tsx scripts/p8/probe-p85h1-sweep.mts

import { renderSectionComponents } from "../../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../../src/public/leadgen/designs/default-funnel/tokens";

type Node = Record<string, unknown>;

// The engine records an input under closest("[data-lg-field]") (render.ts
// handleInputEvent), so the census mirrors that exactly: walk the tag stream,
// keep a stack of open elements' data-lg-field, and attribute every
// data-lg-input to its nearest ancestor-or-self key. A regex that only looked
// at the address wrapper under-counted (a lone full_address puts its key on
// the outer .lg-address div; a NameFieldsGroup input has no data-lg-field
// ancestor at all and is reported as unkeyed here).
const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link", "source"]);
export function inputKeyCensus(html: string): { counts: Record<string, number>; unkeyed: number } {
  const stack: Array<string | null> = [];
  const counts: Record<string, number> = {};
  let unkeyed = 0;
  for (const hit of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const closing = hit[1] === "/";
    const tag = hit[2]!.toLowerCase();
    const attrs = hit[3] ?? "";
    const selfClose = hit[4] === "/" || VOID_TAGS.has(tag);
    if (closing) {
      stack.pop();
      continue;
    }
    const keyHit = attrs.match(/\sdata-lg-field="([^"]*)"/);
    const key = keyHit ? keyHit[1]! : null;
    if (/\sdata-lg-input(\s|=|$)/.test(attrs)) {
      let resolved = key;
      for (let i = stack.length - 1; resolved === null && i >= 0; i--) resolved = stack[i]!;
      if (resolved === null) unkeyed++;
      else counts[resolved] = (counts[resolved] ?? 0) + 1;
    }
    if (!selfClose) stack.push(key);
  }
  return { counts, unkeyed };
}

const addr = (qid: string, base: string, rows: string[], fills?: Record<string, string>): Node => ({
  type: "AddressAutocompleteQuestion",
  question_id: qid,
  internal_field: base,
  props: {
    fields: rows.map((f) => ({ field: f, mode: "autofill" })),
    maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true }, ...(fills ? { fills } : {}) },
  },
});
const text = (key: string, label = "A question"): Node => ({
  type: "FreeTextQuestion",
  question_id: "q_" + key,
  internal_field: key,
  answer_type: "string",
  props: { label },
});
const names = (first: string, last: string): Node => ({
  type: "NameFieldsGroup",
  question_id: "q_names",
  props: { fields: [first, last] },
});
const verr = (key: string): Node => ({ type: "ValidationError", question_id: "q_ve_" + key, internal_field: key });

const CASES: Array<{ name: string; components: Node[] }> = [
  { name: "1  fill -> sibling key, slot RENDERED (the H1 finding)", components: [addr("a", "ad", ["street", "city", "state"], { state: "town" }), text("town", "Town")] },
  { name: "2  fill -> sibling key, slot NOT rendered (the external-fill feature)", components: [addr("a", "ad", ["street", "city"], { state: "town" }), text("town", "Town")] },
  { name: "3  fill -> sibling key on EVERY rendered slot", components: [addr("a", "ad", ["street", "city", "state", "zip"], { street: "s1", city: "s2", state: "s3", zip: "s4" }), text("s1"), text("s2"), text("s3"), text("s4")] },
  { name: "4  fill == the role's OWN default name, sibling carries it too", components: [addr("a", "ad", ["street", "city", "zip"], { zip: "ad_zip" }), text("ad_zip", "Legacy ZIP")] },
  { name: "5  NO fill at all, sibling carries {base}_{slot}", components: [addr("a", "ad", ["street", "city", "zip"]), text("ad_zip", "Legacy ZIP")] },
  { name: "6  two slots aimed at ONE key (the pre-H1 takenBy case)", components: [addr("a", "ad", ["street", "city"], { street: "town", city: "town" }), text("town")] },
  { name: "7  fill -> a NameFieldsGroup part name", components: [addr("a", "ad", ["street", "city"], { city: "last" }), names("first", "last")] },
  { name: "8  fill -> the OTHER Address's rendered role", components: [addr("a", "ad", ["street", "city"], { city: "bd_city" }), addr("b", "bd", ["street", "city"])] },
  { name: "9  two Addresses cross-filling each other", components: [addr("a", "ad", ["street", "city"], { city: "bd_city" }), addr("b", "bd", ["street", "city"], { city: "ad_city" })] },
  { name: "10 two Addresses sharing ONE base (same internal_field)", components: [addr("a", "ad", ["street", "city"]), addr("b", "ad", ["street", "city"])] },
  { name: "11 lone full_address + a sibling named the base", components: [addr("a", "ad", ["full_address"]), text("ad", "Legacy address")] },
  { name: "12 fill -> a key only a ValidationError references (must NOT suppress)", components: [addr("a", "ad", ["street", "city"], { city: "note" }), verr("note")] },
  { name: "13 sibling key == an UNRENDERED role default (no fill)", components: [addr("a", "ad", ["street", "city"]), text("ad_state", "Legacy state")] },
  { name: "14 fill -> sibling, slot rendered, INSIDE a container", components: [{ type: "QuestionGrid", question_id: "g1", children: [addr("a", "ad", ["street", "state"], { state: "town" }), text("town", "Town")] }] },
];

let bad = 0;
for (const c of CASES) {
  const html = renderSectionComponents(c.components as never, defaultFunnelDesign as never, { continue_mode: "button" } as never);
  const { counts, unkeyed } = inputKeyCensus(html);
  const dupes = Object.keys(counts).filter((k) => counts[k]! > 1);
  if (dupes.length > 0) bad++;
  console.log(`${dupes.length > 0 ? "DUPLICATE" : "distinct "} | ${c.name}`);
  console.log(`            keys=${JSON.stringify(counts)} unkeyed-inputs=${unkeyed}${dupes.length > 0 ? "  >1 INPUT: " + JSON.stringify(dupes) : ""}`);
}
console.log(`\n${CASES.length} shapes swept · ${bad} still put two visible inputs on one answer key`);
