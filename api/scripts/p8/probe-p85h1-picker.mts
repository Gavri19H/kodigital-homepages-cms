// P8-5 FIX-FIRST round 2, slice H1 — what the REAL fills picker now SAYS.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1).
//
// The dev server on :8901 died mid-slice and restarting it is denied by the
// sandbox, so the Studio leg of scripts/p8/probe-p85h1-tocttou.mjs (which reads
// the option list off the REAL admin page) could not be re-driven. This runs
// the SAME island source the page ships — sliced straight out of the exported
// SECTION_STUDIO_SCRIPT, never re-typed — in a node:vm against a stub DOM, the
// same technique the shipped acceptance tests use.
//
// Usage: npx tsx scripts/p8/probe-p85h1-picker.mts

import { runInNewContext } from "node:vm";
import { SECTION_STUDIO_SCRIPT, studioTypeMeta } from "../../src/admin/leadgen/ui-section-studio";

function sliceFn(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`island function ${name} not found`);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}" && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}

// --- the stub DOM the picker touches -------------------------------------
interface El {
  tag: string;
  value: string;
  textContent: string;
  disabled: boolean;
  selected: boolean;
  hidden: boolean;
  checked: boolean;
  attrs: Map<string, string>;
  options: El[];
  innerHTML: string;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(c: El): El;
}
function makeEl(tag: string): El {
  const attrs = new Map<string, string>();
  const options: El[] = [];
  const el = {
    tag,
    value: "",
    textContent: "",
    disabled: false,
    selected: false,
    hidden: false,
    checked: false,
    attrs,
    options,
    set innerHTML(_v: string) {
      options.length = 0;
    },
    get innerHTML() {
      return "";
    },
    setAttribute(k: string, v: string) {
      attrs.set(k, String(v));
    },
    getAttribute(k: string) {
      return attrs.has(k) ? attrs.get(k)! : null;
    },
    appendChild(c: El) {
      options.push(c);
      return c;
    },
  } as unknown as El;
  return el;
}

const SLOTS = ["street", "city", "state", "zip"] as const;
const FUNCS = [
  "trimStr",
  "isContainerType",
  "walkTree",
  "findRefIn",
  "findRef",
  "typeMeta",
  "selectedNode",
  "internalFieldsOf",
  "mapsConfigOf",
  "mapsConfigEnabledOf",
  "mapsJobsOf",
  "mapsAnyJobOn",
  "mapsValidateCopyFor",
  "populateMapsTab",
];

function runPicker(content: unknown, selectedQuestionId: string): Record<string, Array<{ v: string; t: string; d: boolean; s: boolean }>> {
  const slots: Record<string, El> = {};
  for (const s of SLOTS) {
    slots[s] = makeEl("select");
    slots[s]!.setAttribute("data-maps-fill-slot", s);
  }
  const routes: Record<string, El> = {};
  for (const sel of [
    "[data-maps-enabled-toggle]",
    "[data-maps-jobs-block]",
    "[data-maps-zero-job-banner]",
    "[data-maps-validate-copy]",
    "[data-maps-autocomplete-copy]",
    "[data-maps-degradation-note]",
    "[data-maps-fills-block]",
  ]) {
    routes[sel] = makeEl("div");
  }
  const document = {
    createElement: (t: string) => makeEl(t),
    querySelector: (sel: string) => routes[sel] ?? null,
    querySelectorAll: (sel: string) => {
      if (sel === "[data-maps-fill-slot]") return SLOTS.map((s) => slots[s]!);
      if (sel === "[data-maps-job]") return [];
      return routes[sel] ? [routes[sel]!] : [];
    },
  };
  const sandbox = {
    state: { content: JSON.parse(JSON.stringify(content)) as unknown },
    studioMeta: { types: studioTypeMeta(), max_depth: 4 },
    selectedQuestionId,
    MAX_DEPTH: 4,
    document,
    console,
  };
  const source = FUNCS.map((f) => sliceFn(SECTION_STUDIO_SCRIPT, f)).join("\n") +
    "\n;populateMapsTab(selectedNode(), typeMeta(selectedNode().type));";
  runInNewContext(source, sandbox);
  const out: Record<string, Array<{ v: string; t: string; d: boolean; s: boolean }>> = {};
  for (const s of SLOTS) {
    out[s] = slots[s]!.options.map((o) => ({ v: o.value, t: o.textContent, d: o.disabled, s: o.selected }));
  }
  return out;
}

const maps = (fills?: Record<string, string>) => ({
  enabled: true,
  jobs: { validate: false, auction: false, autocomplete: true },
  ...(fills ? { fills } : {}),
});

const CASES: Array<{ name: string; content: unknown; show: readonly string[] }> = [
  {
    name: "H1 stage A — state slot NOT rendered, sibling on offer (the feature; must stay claimable)",
    show: ["state"],
    content: {
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "p8_addr", internal_field: "p8_addr", props: { fields: [{ field: "street", mode: "autofill" }, { field: "city", mode: "autofill" }], maps: maps({ state: "p8n_h1_town" }) } },
        { type: "FreeTextQuestion", question_id: "q_town", internal_field: "p8n_h1_town", answer_type: "string", props: { label: "RR Town 2" } },
      ],
    },
  },
  {
    name: "H1 stage B — the SAME stored fill after '+ Add field -> State' (slot now rendered)",
    show: ["state"],
    content: {
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "p8_addr", internal_field: "p8_addr", props: { fields: [{ field: "street", mode: "autofill" }, { field: "city", mode: "autofill" }, { field: "state", mode: "autofill" }], maps: maps({ state: "p8n_h1_town" }) } },
        { type: "FreeTextQuestion", question_id: "q_town", internal_field: "p8n_h1_town", answer_type: "string", props: { label: "RR Town 2" } },
      ],
    },
  },
  {
    name: 'Create "<base>_<slot>" while a SIBLING already answers that exact key',
    show: ["zip"],
    content: {
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "p8_addr", internal_field: "p8_addr", props: { fields: [{ field: "street", mode: "autofill" }, { field: "zip", mode: "autofill" }], maps: maps() } },
        { type: "FreeTextQuestion", question_id: "q_lz", internal_field: "p8_addr_zip", answer_type: "string", props: { label: "Legacy ZIP" } },
      ],
    },
  },
  {
    name: 'Create "<base>_<slot>" with NOTHING else answering it (must stay unadorned)',
    show: ["zip"],
    content: {
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "p8_addr", internal_field: "p8_addr", props: { fields: [{ field: "street", mode: "autofill" }, { field: "zip", mode: "autofill" }], maps: maps() } },
        { type: "FreeTextQuestion", question_id: "q_note", internal_field: "note_field", answer_type: "string", props: { label: "Note" } },
      ],
    },
  },
];

for (const c of CASES) {
  const res = runPicker(c.content, "p8_addr");
  console.log(`\n${c.name}`);
  for (const s of c.show) console.log(`  slot "${s}": ${JSON.stringify(res[s])}`);
}
