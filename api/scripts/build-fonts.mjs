#!/usr/bin/env node
// Build the same-origin /lg/runtime/lgfonts/ files and @font-face rules for quote funnels.
//   node scripts/build-fonts.mjs --offline   reuse the committed bytes and license notices
//   node scripts/build-fonts.mjs             refresh from pinned Fontsource packages

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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

// The committed module is the offline source, including before the switch
// from embedded CSS data URLs to the path-keyed file map.
function readGeneratedFonts(source) {
  const files = new Map();
  const fileEntry = /^  \["\/lg\/(?:runtime\/lgfonts|fonts)\/([a-z0-9-]+)\.[a-f0-9]{16}\.woff2", "([A-Za-z0-9+/=]+)"\],$/gm;
  for (const [, name, base64] of source.matchAll(fileEntry)) {
    files.set(name, Buffer.from(base64, "base64"));
  }
  const embeddedFace = /font-family:'([^']+)';font-style:normal;font-weight:(\d+);font-display:swap;src:url\(\\"data:font\/woff2;base64,([A-Za-z0-9+/=]+)\\"\)/g;
  for (const [, family, weight, base64] of source.matchAll(embeddedFace)) {
    files.set(`${family.toLowerCase().replaceAll(" ", "-")}-${weight}`, Buffer.from(base64, "base64"));
  }
  return { files, licenses: source.match(/^\/\/   .+$/gm) ?? [] };
}

function fontFaceBlock(family, weight, path) {
  return (
    `@font-face{` +
    `font-family:'${family}';` +
    `font-style:normal;` +
    `font-weight:${weight};` +
    `font-display:swap;` +
    `src:url("${path}") format("woff2")` +
    `}`
  );
}

function tsStringLiteral(s) {
  return JSON.stringify(s);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--offline")) {
    throw new Error("Usage: node scripts/build-fonts.mjs [--offline]");
  }
  const saved = args.length ? readGeneratedFonts(readFileSync(OUT_PATH, "utf8")) : null;
  const families = CURATED.map((f) => f.family);
  if (new Set(families).size !== families.length) {
    throw new Error("CURATED contains duplicate family names — fix the list before fetching");
  }

  const faceCssByFamily = {};
  const fileEntries = [];
  const displayEntries = [];
  const licenseNotes = [];
  let totalRaw = 0;

  for (const font of CURATED) {
    const blocks = [];
    // The funnel headline has weight 600. CSS uses the next heavier face
    // when a family has no 600, then the heaviest lighter face.
    const displayWeight = font.weights.find(weight => weight >= 600) ?? font.weights.at(-1);
    for (const weight of font.weights) {
      const name = `${font.pkg}-${weight}`;
      const url = `${CDN}/${font.pkg}@${FONTSOURCE_VERSION}/files/${font.pkg}-latin-${weight}-normal.woff2`;
      const buf = saved ? saved.files.get(name) : await fetchBuffer(url);
      if (buf?.toString("ascii", 0, 4) !== "wOF2") throw new Error(`Missing or invalid WOFF2 for ${name}`);
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const path = `/lg/runtime/lgfonts/${name}.${hash}.woff2`;
      totalRaw += buf.length;
      blocks.push(fontFaceBlock(font.family, weight, path));
      fileEntries.push(`  ["${path}", "${buf.toString("base64")}"],`);
      if (weight === displayWeight) displayEntries.push(`  ["${font.family}", "${path}"],`);
    }
    faceCssByFamily[font.family] = blocks.join("");

    // Best-effort verbatim license provenance (OFL-1.1 requires the notice to
    // travel with the font). We record the SPDX id + the upstream LICENSE URL;
    // the copyright/reserved-font-name line is pulled from the package LICENSE
    // when reachable, else the SPDX id + source stand as the provenance.
    const prefix = `//   ${font.family} (${font.category}, weights ${font.weights.join("/")}) — ` +
      `${font.license}; @fontsource/${font.pkg}@${FONTSOURCE_VERSION}; `;
    if (saved) {
      const note = saved.licenses.find(line => line.startsWith(prefix));
      if (!note) throw new Error(`Missing license notice for ${font.family} at ${FONTSOURCE_VERSION}`);
      licenseNotes.push(note);
      continue;
    }
    const licenseUrl = `${CDN}/${font.pkg}@${FONTSOURCE_VERSION}/LICENSE`;
    const licenseText = await fetchTextOptional(licenseUrl);
    const firstLines = licenseText
      ? licenseText.split("\n").slice(0, 3).map((l) => l.trim()).filter(Boolean).join(" | ")
      : "(LICENSE file not fetched — see source)";
    licenseNotes.push(prefix + firstLines);
  }

  const familyNamesTs = families.map((f) => `  ${tsStringLiteral(f)},`).join("\n");

  const faceEntriesTs = CURATED.map(
    (f) => `  ${tsStringLiteral(f.family)}: ${tsStringLiteral(faceCssByFamily[f.family])},`,
  ).join("\n");

  const header = `// AUTO-GENERATED by \`node scripts/build-fonts.mjs\` — DO NOT EDIT BY HAND.
// Rebuild from this module with \`node scripts/build-fonts.mjs --offline\`.
// The /lg/runtime/lgfonts/ handler serves the Latin WOFF2 bytes. The CSS references
// same-origin paths containing the first 16 hex digits of each file's SHA-256.
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
// The CSS family names styles.ts scans the resolved design's font slots for.
export const LEADGEN_SELF_HOSTED_FONT_FAMILIES: readonly string[] = [
${familyNamesTs}
];

// family (CSS name) -> its concatenated @font-face blocks (one per weight),
// each with a same-origin WOFF2 src.
export const LEADGEN_FONT_FACE_CSS: Record<string, string> = {
${faceEntriesTs}
};

export const LEADGEN_DISPLAY_FONT_PATHS: ReadonlyMap<string, string> = new Map([
${displayEntries.join("\n")}
]);

export const LEADGEN_FONT_FILES: ReadonlyMap<string, string> = new Map([
${fileEntries.join("\n")}
]);

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
  console.log(`  WOFF2 files: ${fileEntries.length} (${totalRaw} bytes)`);
  console.log(`  bytes written: ${Buffer.byteLength(header + body, "utf8")}`);
}

main().catch((err) => {
  console.error(`build-fonts FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
