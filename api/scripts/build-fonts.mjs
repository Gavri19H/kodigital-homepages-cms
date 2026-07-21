#!/usr/bin/env node
// build-fonts — Round-4 P6 THEME v2 (D-7) self-hosted font pipeline.
//
// WHY: the LeadGen theme font ids (theme.ts THEME_FONT_STACKS) name font
// families by CSS name only — pre-P6 NOTHING loaded a real webfont, so a
// funnel picking 'Literata'/'Sora' silently fell back to Georgia/system-ui.
// P6 adds a CURATED SELF-HOSTED family set so a theme's display/body choice
// renders as the intended typeface, with a hard security/perf requirement:
// ZERO external font requests on the live funnel (no fonts.googleapis.com / no
// fonts.gstatic.com / no runtime CDN). Decision (contract-approved, mirrors
// the P1 Tabler icon pipeline scripts/build-icons.mjs): vendor WOFF2 Latin
// subsets at BUILD TIME into a committed generated module, base64-inlined and
// served same-origin as `data:` URLs in the @font-face `src` — no npm runtime
// dependency, no runtime fetch; this script runs ONCE, by hand, and its OUTPUT
// (src/public/leadgen/designs/fonts.generated.ts) is committed.
//
// WHAT THIS SCRIPT DOES: for each curated family/weight it fetches the
// PRE-BUILT Latin-subset WOFF2 from a PINNED @fontsource package on jsDelivr
// (Fontsource repackages the upstream OFL/Apache Google Fonts; the Latin
// subset is already built — no local fonttools/woff2 tooling needed), base64-
// encodes it, and writes:
//   export const LEADGEN_FONT_FAMILIES        (metadata: family/category/weights/license)
//   export const LEADGEN_SELF_HOSTED_FONT_FAMILIES: readonly string[]  (CSS family names)
//   export const LEADGEN_FONT_FACE_CSS: Record<string,string>          (family -> @font-face blocks)
//   export function selfHostedFontFaceCss(families): string            (dedup, deterministic emit)
//
// SAME-ORIGIN GUARANTEE: every @font-face `src` is a `data:font/woff2;base64,…`
// URL — same-origin by construction. styles.ts scans the RESOLVED design's
// font slots and emits ONLY the referenced families' @font-face at the top of
// the funnel chrome <style> block, so a live page issues ZERO font network
// requests. A CI/test gate asserts no external font URL appears in served CSS.
//
// BYTE-COMPAT: the base design's own families ('Sora'/'Literata'/'Newsreader')
// and the back-compat theme ids (literata/sora/system) are DELIBERATELY NOT in
// this self-hosted set — so a legacy/v1 funnel never matches a self-hosted
// family, emits no @font-face, and renders byte-identically to pre-P6.
//
// USAGE: node scripts/build-fonts.mjs   (run from api/, or anywhere — paths
// are resolved from this file's own location). Requires network access to
// cdn.jsdelivr.net + data.jsdelivr.com. Re-run after bumping FONTSOURCE_VERSION
// (or editing CURATED); the diff of the committed fonts.generated.ts IS the
// review artifact for that refresh.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_PATH = resolve(API_ROOT, "src/public/leadgen/designs/fonts.generated.ts");

// Pinned Fontsource release (all @fontsource/* packages share the v5 line;
// data.jsdelivr.com resolved ^5 -> 5.3.0 for every curated package on the pin
// date — verified before pinning). Bump deliberately; re-run; review the diff.
const FONTSOURCE_VERSION = "5.3.0";
const CDN = "https://cdn.jsdelivr.net/npm/@fontsource";

// ---------------------------------------------------------------------------
// The curated set (8 families). Every family here is OFL-1.1 licensed (SIL
// Open Font License) EXCEPT where noted; all are redistributable and safe to
// self-host. `family` is the EXACT CSS font-family name (must match the
// quoted name in theme.ts THEME_FONT_STACKS and what styles.ts scans for).
// `pkg` is the @fontsource npm package; the Latin-subset file for a weight is
// `<pkg>-latin-<weight>-normal.woff2`. Weights chosen to serve the display
// ramp (a bold 700 for display-XXL headlines) and body UI (400 + a semibold).
// ---------------------------------------------------------------------------
const CURATED = [
  // --- display families (headlines; include a bold for display-XXL) --------
  { family: "Poppins", pkg: "poppins", category: "display", weights: [400, 600, 700], license: "OFL-1.1" },
  { family: "Space Grotesk", pkg: "space-grotesk", category: "display", weights: [400, 700], license: "OFL-1.1" },
  { family: "Fraunces", pkg: "fraunces", category: "display-serif", weights: [400, 700], license: "OFL-1.1" },
  { family: "Playfair Display", pkg: "playfair-display", category: "display-serif", weights: [400, 700], license: "OFL-1.1" },
  // --- body families (paragraph/UI) ----------------------------------------
  { family: "Manrope", pkg: "manrope", category: "body", weights: [400, 700], license: "OFL-1.1" },
  { family: "DM Sans", pkg: "dm-sans", category: "body", weights: [400, 700], license: "OFL-1.1" },
  { family: "Work Sans", pkg: "work-sans", category: "body", weights: [400, 600], license: "OFL-1.1" },
  { family: "Lexend", pkg: "lexend", category: "body", weights: [400, 600], license: "OFL-1.1" },
];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchTextOptional(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

// One @font-face block per weight, base64 data: src (same-origin). font-display
// swap so text paints immediately in the fallback then upgrades. Deterministic
// string (fixed property order) so a re-run diffs cleanly.
function fontFaceBlock(family, weight, base64) {
  return (
    `@font-face{` +
    `font-family:'${family}';` +
    `font-style:normal;` +
    `font-weight:${weight};` +
    `font-display:swap;` +
    `src:url("data:font/woff2;base64,${base64}") format("woff2")` +
    `}`
  );
}

function tsStringLiteral(s) {
  return JSON.stringify(s);
}

async function main() {
  const families = CURATED.map((f) => f.family);
  if (new Set(families).size !== families.length) {
    throw new Error("CURATED contains duplicate family names — fix the list before fetching");
  }

  console.log(
    `build-fonts: fetching ${CURATED.reduce((n, f) => n + f.weights.length, 0)} WOFF2 subsets ` +
      `for ${CURATED.length} families from @fontsource@${FONTSOURCE_VERSION} ...`,
  );

  const faceCssByFamily = {};
  const licenseNotes = [];
  let totalRaw = 0;
  let totalB64 = 0;

  for (const font of CURATED) {
    const blocks = [];
    for (const weight of font.weights) {
      const url = `${CDN}/${font.pkg}@${FONTSOURCE_VERSION}/files/${font.pkg}-latin-${weight}-normal.woff2`;
      const buf = await fetchBuffer(url);
      const b64 = buf.toString("base64");
      totalRaw += buf.length;
      totalB64 += b64.length;
      blocks.push(fontFaceBlock(font.family, weight, b64));
    }
    faceCssByFamily[font.family] = blocks.join("");

    // Best-effort verbatim license provenance (OFL-1.1 requires the notice to
    // travel with the font). We record the SPDX id + the upstream LICENSE URL;
    // the copyright/reserved-font-name line is pulled from the package LICENSE
    // when reachable, else the SPDX id + source stand as the provenance.
    const licenseUrl = `${CDN}/${font.pkg}@${FONTSOURCE_VERSION}/LICENSE`;
    const licenseText = await fetchTextOptional(licenseUrl);
    const firstLines = licenseText
      ? licenseText.split("\n").slice(0, 3).map((l) => l.trim()).filter(Boolean).join(" | ")
      : "(LICENSE file not fetched — see source)";
    licenseNotes.push(
      `//   ${font.family} (${font.category}, weights ${font.weights.join("/")}) — ` +
        `${font.license}; @fontsource/${font.pkg}@${FONTSOURCE_VERSION}; ${firstLines}`,
    );
  }

  const familyMetaTs = CURATED.map(
    (f) =>
      `  { family: ${tsStringLiteral(f.family)}, category: ${tsStringLiteral(f.category)}, ` +
      `weights: [${f.weights.join(", ")}], license: ${tsStringLiteral(f.license)}, ` +
      `pkg: ${tsStringLiteral(`@fontsource/${f.pkg}@${FONTSOURCE_VERSION}`)} },`,
  ).join("\n");

  const familyNamesTs = families.map((f) => `  ${tsStringLiteral(f)},`).join("\n");

  const faceEntriesTs = CURATED.map(
    (f) => `  ${tsStringLiteral(f.family)}: ${tsStringLiteral(faceCssByFamily[f.family])},`,
  ).join("\n");

  const header = `// AUTO-GENERATED by \`node scripts/build-fonts.mjs\` — DO NOT EDIT BY HAND.
// Re-run the script (after deliberately bumping FONTSOURCE_VERSION or editing
// CURATED there) to refresh this file; the output is committed (build-time
// vendoring — ZERO runtime or npm dependency). Round-4 P6 THEME v2 (D-7)
// self-hosted font pipeline.
//
// Each family below is a WOFF2 Latin subset from the pinned @fontsource
// package (Fontsource repackages the upstream OFL/Apache Google Fonts), base64-
// inlined and served same-origin as a \`data:font/woff2\` URL in the @font-face
// \`src\` — so a live funnel issues ZERO external font requests. styles.ts scans
// the resolved design's font slots and emits ONLY the referenced families'
// @font-face (selfHostedFontFaceCss) at the top of the funnel chrome <style>.
//
// -----------------------------------------------------------------------
// Font licenses (SIL Open Font License 1.1 unless noted). The full OFL text
// travels with each @fontsource package; provenance recorded per family:
// -----------------------------------------------------------------------
${licenseNotes.join("\n")}
// -----------------------------------------------------------------------
//
// BYTE-COMPAT: the base design families ('Sora'/'Literata'/'Newsreader') and
// the back-compat theme ids (literata/sora/system) are intentionally ABSENT
// here — a legacy/v1 funnel never matches a self-hosted family, so it emits no
// @font-face and renders byte-identically to pre-P6.
`;

  const body = `
export interface LeadgenFontFamilyMeta {
  readonly family: string;
  readonly category: string;
  readonly weights: readonly number[];
  readonly license: string;
  readonly pkg: string;
}

export const LEADGEN_FONT_FAMILIES: readonly LeadgenFontFamilyMeta[] = [
${familyMetaTs}
];

// The CSS family names styles.ts scans the resolved design's font slots for.
export const LEADGEN_SELF_HOSTED_FONT_FAMILIES: readonly string[] = [
${familyNamesTs}
];

// family (CSS name) -> its concatenated @font-face blocks (one per weight),
// each with a same-origin data:font/woff2 src.
export const LEADGEN_FONT_FACE_CSS: Record<string, string> = {
${faceEntriesTs}
};

// Emit the @font-face CSS for the given CSS family names, DEDUPLICATED and in a
// DETERMINISTIC order (LEADGEN_SELF_HOSTED_FONT_FAMILIES order — never the
// caller's iteration order, so the same referenced set always produces the
// same bytes). Unknown families are skipped. Empty input (a legacy funnel that
// references no self-hosted family) returns "" — byte-identical to pre-P6.
export function selfHostedFontFaceCss(families: Iterable<string>): string {
  const want = new Set(families);
  let out = "";
  for (const family of LEADGEN_SELF_HOSTED_FONT_FAMILIES) {
    if (want.has(family)) out += LEADGEN_FONT_FACE_CSS[family] ?? "";
  }
  return out;
}
`;

  writeFileSync(OUT_PATH, header + body, "utf8");

  console.log(`build-fonts: wrote ${OUT_PATH}`);
  console.log(`  version: @fontsource@${FONTSOURCE_VERSION}`);
  console.log(`  families: ${CURATED.length} (${families.join(", ")})`);
  console.log(`  weights fetched: ${CURATED.reduce((n, f) => n + f.weights.length, 0)}`);
  console.log(`  woff2 raw: ${(totalRaw / 1024).toFixed(0)} KB; base64 inlined: ${(totalB64 / 1024).toFixed(0)} KB`);
  console.log(`  bytes written: ${Buffer.byteLength(header + body, "utf8")}`);
}

main().catch((err) => {
  console.error(`build-fonts FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
