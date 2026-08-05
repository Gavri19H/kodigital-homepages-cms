// P8-5 slice W1 — the runtime ZIP-key derivation, DRIVEN.
//
// MISSION EVIDENCE TOOLING ONLY: never wired into CI / package.json /
// verify:all (contract §1).
//
// One section, authored exactly like the reported defect:
//   · an AddressAutocompleteQuestion (base "l1_addr") whose props.maps.fills
//     renames its ZIP slot onto "pcx";
//   · a sibling FreeTextQuestion that ALREADY answers "pcx".
//
// Three real legs over the SAME authored nodes, no hand-built config anywhere:
//   1. RENDERER  — presets.renderSectionComponents → the data-lg-field each
//      visible input actually carries (the key the visitor's typing lands on).
//   2. PRODUCER  — config-dto.projectSectionComponents → the compiled client
//      config the runtime is served.
//   3. CONSUMER  — runtime/validation.validateSection over that compiled
//      config with the answers a visitor who typed a VALID zip would have.
//
// Usage: npx tsx scripts/p8/probe-p85w1-zipkey.mts

import { renderSectionComponents } from "../../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../../src/public/leadgen/designs/default-funnel/tokens";
import { projectSectionComponents } from "../../src/public/leadgen/config-dto";
import { validateSection } from "../../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../../src/public/leadgen/runtime/state";
import { applyPreviewSimMarkup } from "../../src/admin/leadgen/preview-sim";

const nodes = [
  {
    type: "AddressAutocompleteQuestion",
    question_id: "l1_addr",
    internal_field: "l1_addr",
    props: {
      fields: [
        { field: "street", required: false },
        { field: "zip", validation: "zip5", required: true },
      ],
      maps: { fills: { zip: "pcx" } },
    },
  },
  {
    type: "FreeTextQuestion",
    question_id: "q_pcx",
    internal_field: "pcx",
    answer_type: "text",
    props: {},
  },
];

// ---- 1. RENDERER --------------------------------------------------------
const html = renderSectionComponents(nodes as never, defaultFunnelDesign as never, {
  continue_mode: "button",
} as never);
const inputKeys: string[] = [];
for (const hit of html.matchAll(/<span class="lg-address-field-wrap" data-lg-field="([^"]+)"/g)) {
  inputKeys.push(hit[1]!);
}
for (const hit of html.matchAll(/data-lg-field="([^"]+)"[^>]*data-lg-input/g)) {
  inputKeys.push(hit[1]!);
}
console.log("1. RENDERED input keys:", JSON.stringify(inputKeys));

// ---- 2. PRODUCER --------------------------------------------------------
const compiled = projectSectionComponents(nodes as never);
const addr = compiled[0] as unknown as { props?: Record<string, unknown> };
console.log("2. COMPILED props.maps:", JSON.stringify(addr.props?.["maps"]));
console.log(
  "2. COMPILED resolved_fields:",
  JSON.stringify((addr.props?.["maps"] as Record<string, unknown> | undefined)?.["resolved_fields"]),
);

// ---- 3. CONSUMER --------------------------------------------------------
const vis = compiled.map((c) => ({
  question_id: (c as { question_id: string }).question_id,
  visible: true,
  required_now: false,
}));

const run = (label: string, answers: Record<string, unknown>): void => {
  const failures = validateSection(compiled as unknown as LgComponentConfig[], answers, vis);
  console.log(`3. ${label}`);
  console.log(`     answers   : ${JSON.stringify(answers)}`);
  console.log(`     failures  : ${JSON.stringify(failures)}`);
};

// (a) the reported visitor: a VALID 5-digit zip in the real ZIP box, free text
//     in the sibling. Live must let them continue.
run("VALID ZIP visitor", { l1_addr_zip: "94043", pcx: "not-a-zip" });

// (b) the same visitor with a MALFORMED zip in the real ZIP box. Live must
//     still block them, keyed to the box they typed in.
run("MALFORMED ZIP visitor", { l1_addr_zip: "9404", pcx: "not-a-zip" });

// (c) control — no collision (no sibling claims "pcx"): the rename IS applied
//     by the renderer, so the validator must follow it onto "pcx".
const solo = [nodes[0]];
const soloHtml = renderSectionComponents(solo as never, defaultFunnelDesign as never, {
  continue_mode: "button",
} as never);
const soloKeys: string[] = [];
for (const hit of soloHtml.matchAll(
  /<span class="lg-address-field-wrap" data-lg-field="([^"]+)"/g,
)) {
  soloKeys.push(hit[1]!);
}
const soloCompiled = projectSectionComponents(solo as never);
const soloVis = soloCompiled.map((c) => ({
  question_id: (c as { question_id: string }).question_id,
  visible: true,
  required_now: false,
}));
// ---- 3b. STUDIO CANVAS (preview-sim, admin) ------------------------------
// applyPreviewSimMarkup rewrites the SAME real rendered html. Which
// [data-lg-field] block does it mark, and which [data-lg-error-for] slot does
// it fill?
const classOfFieldBlock = (markup: string, key: string): string | null => {
  const at = markup.indexOf(`data-lg-field="${key}"`);
  if (at === -1) return null;
  const open = markup.lastIndexOf("<", at);
  const close = markup.indexOf(">", at);
  const cls = markup.slice(open, close + 1).match(/\sclass="([^"]*)"/);
  return cls === null ? "" : cls[1]!;
};
const slotText = (markup: string, key: string): string | null => {
  const hit = markup.match(new RegExp(`<p[^>]*data-lg-error-for="${key}"[^>]*>([^<]*)</p>`));
  return hit === null ? null : hit[1]!;
};

for (const state of ["error", "validation_error"] as const) {
  const simmed = applyPreviewSimMarkup(html, nodes as never, defaultFunnelDesign as never, {
    state,
    markSelection: false,
    answers: {},
    visibleIds: null,
    requiredNow: null,
  });
  console.log(`\n3b. CANVAS state="${state}"`);
  for (const key of ["l1_addr_zip", "pcx"]) {
    console.log(
      `     [data-lg-field="${key}"] class=${JSON.stringify(classOfFieldBlock(simmed, key))}` +
        `  slot[data-lg-error-for="${key}"]=${JSON.stringify(slotText(simmed, key))}`,
    );
  }
}

console.log("\n4. CONTROL (no sibling claims 'pcx')");
console.log("     RENDERED input keys:", JSON.stringify(soloKeys));
for (const [label, answers] of [
  ["rename honoured, valid zip in 'pcx'", { pcx: "94043" }],
  ["rename honoured, malformed zip in 'pcx'", { pcx: "9404" }],
] as const) {
  const f = validateSection(
    soloCompiled as unknown as LgComponentConfig[],
    answers as Record<string, unknown>,
    soloVis,
  );
  console.log(`     ${label}: ${JSON.stringify(f)}`);
}
