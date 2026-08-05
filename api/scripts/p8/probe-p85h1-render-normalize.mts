// P8-5 FIX-FIRST round 2, slice H1 — the SERVER-LEG measurement.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1).
//
// Runs the REAL renderer (renderSectionComponents — the same function that
// produces the served content_html) and the REAL server-side answer
// normalisation (answers.ts normalizeAnswers — the /lg/auction leg) over the
// REAL stage-B content dumped straight out of the admin API by
// scripts/p8/probe-p85h1-tocttou.mjs, together with the REAL answers object a
// driven browser POSTed to /lg/auction in that same run.
//
// Usage: npx tsx scripts/p8/probe-p85h1-render-normalize.mts <dump.json>

import { readFileSync } from "node:fs";
import { renderSectionComponents } from "../../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../../src/public/leadgen/designs/default-funnel/tokens";
import { normalizeAnswers } from "../../src/leadgen/answers";

const dumpPath = process.argv[2] ?? "/tmp/p85h1-stageB.json";
const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as {
  content: { components: unknown[] };
  posted: Record<string, { value: unknown }> | null;
};

const html = renderSectionComponents(dump.content.components as never, defaultFunnelDesign as never, {
  continue_mode: "button",
} as never);

// Which answer key does each INPUT-bearing wrapper carry? An address field-set
// wraps every input in <span class="lg-address-field-wrap" data-lg-field=...>;
// a scalar question puts data-lg-field on the input itself.
const inputKeys: string[] = [];
for (const hit of html.matchAll(/<span class="lg-address-field-wrap" data-lg-field="([^"]+)"/g)) {
  inputKeys.push(hit[1]!);
}
for (const hit of html.matchAll(/data-lg-field="([^"]+)"[^>]*data-lg-input/g)) {
  inputKeys.push(hit[1]!);
}

const counts: Record<string, number> = {};
for (const k of inputKeys) counts[k] = (counts[k] ?? 0) + 1;
const dupes = Object.keys(counts).filter((k) => counts[k]! > 1);

console.log("dump:", dumpPath);
console.log("RENDERED input keys:", JSON.stringify(inputKeys));
console.log("RENDERED census:", JSON.stringify(counts));
console.log("KEYS ON MORE THAN ONE INPUT:", JSON.stringify(dupes));

// --- the server leg -------------------------------------------------------
// (a) the REAL posted body, exactly as the driven browser sent it.
const unwrap = (raw: Record<string, { value: unknown }> | null): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = v && typeof v === "object" && "value" in v ? v.value : v;
  return out;
};
const real = unwrap(dump.posted);
const realNorm = normalizeAnswers(dump.content as never, real as never);
console.log("\nREAL posted answers (driven browser):", JSON.stringify(real));
console.log("normalizeAnswers(real posted) ->", JSON.stringify(realNorm.answers));

// (b) SIMULATED: the same typed values re-keyed onto the keys THIS render
// emits. Labelled a simulation, not a driven POST — the visitor leg could not
// be re-driven (dev server on :8901 down; restart denied by the sandbox).
const sim: Record<string, unknown> = { ...real };
const typedFor = (k: string): string => (/state/i.test(k) ? "CA" : /town/i.test(k) ? "SIBLING-TOWN" : "TYPED " + k);
for (const k of inputKeys) if (!(k in sim)) sim[k] = typedFor(k);
const simNorm = normalizeAnswers(dump.content as never, sim as never);
console.log("\nSIMULATED posted answers (this render's key set):", JSON.stringify(sim));
console.log("normalizeAnswers(simulated) ->", JSON.stringify(simNorm.answers));

const rendered = new Set(inputKeys);
const dropped = [...rendered].filter((k) => !(k in simNorm.answers));
console.log("RENDERED keys the server leg does NOT keep:", JSON.stringify(dropped));
