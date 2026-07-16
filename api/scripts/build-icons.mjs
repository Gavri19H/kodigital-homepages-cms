#!/usr/bin/env node
// build-icons — Section Builder P1b Tabler icon pipeline (register PC-11).
//
// WHY: the pre-P1b field/card icon set was 11 hand-drawn SVGs hardcoding
// `width="19" height="19"` + `stroke="#8DA0B6"` — so the 32px card-icon size
// token AND the §9.4 iconColor override were both no-ops on them (a
// hardcoded attribute always wins over a CSS token the icon never reads),
// and the operator's own reference screenshots use 48-64px icons the old
// 11-icon library simply didn't have. Decision (contract-approved): vendor a
// curated ~100-icon subset of Tabler Icons (MIT) at BUILD TIME, normalized so
// every icon is re-sizable (no baked-in width/height) and re-colorable
// (stroke="currentColor").
//
// WHAT THIS SCRIPT DOES: fetches each curated icon's "outline" SVG from a
// PINNED Tabler Icons release tag (raw.githubusercontent.com — no npm
// dependency, no runtime fetch; this script runs ONCE, by hand, and its
// OUTPUT is committed), normalizes it to a fixed shape, and writes
// `../src/public/leadgen/components/icons.generated.ts`:
//   export const LEADGEN_ICON_NAMES = [...] as const;   (validated enum)
//   export const LEADGEN_ICONS: Record<string, string>; (name -> raw svg)
//   export function leadgenIconSvg(name, sizePx): string; (sized emit)
//
// NORMALIZATION: every source icon is asserted to already carry
// viewBox="0 0 24 24" / fill="none" / stroke="currentColor" (Tabler's own
// outline-set default — true for the whole set as of the pinned tag), then
// re-serialized with a FIXED opening tag (attribute order/whitespace
// pinned) and NO width/height — leadgenIconSvg() injects those at emit time,
// so one committed source string serves every size the product needs (20px
// leading-field icons, 48px card icons, ...).
//
// BACK-COMPAT: the pre-P1b 12-value vocabulary (location/calendar/dollar/
// phone/email/lock/person/home/car/shield/star/none) must keep resolving
// with ZERO content_json migration. 7 of those ids already spell a real
// Tabler name (calendar/phone/lock/home/car/shield/star) and need no alias.
// The remaining 4 are aliased to their Tabler equivalent (LEGACY_ALIASES
// below): location->map-pin, dollar->currency-dollar, email->mail,
// person->user. "none" is not a Tabler icon — it is this product's own
// sentinel for "no icon", mapped to the empty string (unchanged from
// pre-P1b).
//
// USAGE: node scripts/build-icons.mjs   (run from api/, or anywhere — paths
// are resolved from this file's own location). Requires network access to
// raw.githubusercontent.com. Re-run after bumping TABLER_TAG to refresh the
// vendored set; the diff of the committed icons.generated.ts IS the review
// artifact for that refresh.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_PATH = resolve(
  API_ROOT,
  "src/public/leadgen/components/icons.generated.ts",
);

// Pinned release tag (real, existing tag — verified via
// https://api.github.com/repos/tabler/tabler-icons/tags before pinning).
// Bump deliberately; re-run this script; review the resulting diff.
const TABLER_TAG = "v3.44.0";
const TABLER_REPO = "https://github.com/tabler/tabler-icons";
const TABLER_RAW_BASE = `https://raw.githubusercontent.com/tabler/tabler-icons/${TABLER_TAG}`;
const ICON_BASE = `${TABLER_RAW_BASE}/icons/outline`;
const LICENSE_URL = `${TABLER_RAW_BASE}/LICENSE`;

// ---------------------------------------------------------------------------
// The curated set (~100 names), grouped by category purely for readability
// here — the generated file is a flat map. Every name below is a REAL Tabler
// "outline" icon filename at TABLER_TAG (verified with a live HTTP HEAD/GET
// pass before this list was finalized).
// ---------------------------------------------------------------------------
const CURATED = [
  // Insurance & protection
  "shield", "shield-check", "shield-lock", "shield-half", "umbrella",
  "lock", "lock-open", "key", "certificate",
  // Home & property
  "home", "home-2", "home-check", "building", "building-warehouse",
  "building-store", "building-bank", "door", "bed",
  // Vehicles
  "car", "truck", "truck-delivery", "motorbike", "bike", "plane",
  // Health
  "heart", "heartbeat", "heart-rate-monitor", "first-aid-kit", "stethoscope",
  "pill", "vaccine", "wheelchair", "dental", "building-hospital",
  "medical-cross",
  // Finance & money
  "currency-dollar", "coin", "coins", "calculator", "credit-card", "wallet",
  "receipt", "cash", "pig",
  // Contact
  "phone", "phone-call", "mail", "message", "message-circle", "send",
  // People
  "user", "users", "user-circle", "users-group",
  // Time & calendar
  "calendar", "calendar-event", "calendar-check", "clock", "hourglass",
  "alarm",
  // Location
  "map-pin", "map", "route", "compass",
  // Status & actions
  "check", "x", "alert-circle", "alert-triangle", "info-circle",
  "circle-check", "star", "flag",
  // Rewards
  "gift", "trophy", "award", "medal", "badge",
  // Tools & work
  "briefcase", "tool", "tools", "settings", "adjustments",
  // Nature & weather
  "paw", "leaf", "tree", "sun", "cloud", "droplet", "bolt",
  // Media & tech
  "camera", "wifi", "world", "globe", "device-mobile", "device-laptop",
  "printer",
  // Interface (studio/UI needs)
  "search", "filter", "plus", "minus", "edit", "trash", "download", "eye",
];

// Back-compat: pre-P1b semantic id -> its Tabler equivalent. Only the 4 ids
// whose spelling actually DIFFERS from a curated Tabler name need an entry —
// calendar/phone/lock/home/car/shield/star already ARE curated Tabler names
// (see CURATED above) so they resolve with no alias.
const LEGACY_ALIASES = {
  location: "map-pin",
  dollar: "currency-dollar",
  email: "mail",
  person: "user",
};

const PRE_P1B_LEGACY_IDS = [
  "location", "calendar", "dollar", "phone", "email", "lock", "person",
  "home", "car", "shield", "star", "none",
];

const FIXED_OPEN_TAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// Strips the Tabler metadata comment, asserts the expected attribute shape,
// and re-serializes with FIXED_OPEN_TAG + NO width/height (leadgenIconSvg
// injects those at emit — see the generated file's own doc comment).
function normalizeSvg(raw, name) {
  const noComment = raw.replace(/<!--[\s\S]*?-->/g, "");
  const m = noComment.match(/<svg([^>]*)>([\s\S]*?)<\/svg>/);
  if (!m) throw new Error(`${name}: could not find a parseable <svg>...</svg> element`);
  const attrs = m[1] ?? "";
  const inner = m[2] ?? "";
  const requireAttr = (re, label) => {
    if (!re.test(attrs)) {
      throw new Error(
        `${name}: expected ${label} in the source <svg ${attrs.trim()}> — Tabler's outline-set shape may have changed; investigate before trusting the normalized output`,
      );
    }
  };
  requireAttr(/viewBox="0 0 24 24"/, 'viewBox="0 0 24 24"');
  requireAttr(/fill="none"/, 'fill="none"');
  requireAttr(/stroke="currentColor"/, 'stroke="currentColor"');
  const normalizedInner = inner.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
  if (normalizedInner === "") throw new Error(`${name}: empty <svg> body after normalization`);
  return `${FIXED_OPEN_TAG}${normalizedInner}</svg>`;
}

// Small fixed-size concurrency pool — polite to raw.githubusercontent.com,
// fast enough for ~100 fetches (no new npm dependency, hand-rolled).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function tsStringLiteral(s) {
  return JSON.stringify(s);
}

async function main() {
  const uniqueCurated = Array.from(new Set(CURATED));
  if (uniqueCurated.length !== CURATED.length) {
    throw new Error("CURATED contains duplicate names — fix the list before fetching");
  }

  console.log(`build-icons: fetching ${uniqueCurated.length} curated icons from ${TABLER_REPO}@${TABLER_TAG} ...`);

  const fetched = await mapWithConcurrency(uniqueCurated, 8, async (name) => {
    const raw = await fetchText(`${ICON_BASE}/${name}.svg`);
    return [name, normalizeSvg(raw, name)];
  });

  const iconMap = new Map(fetched);

  // Legacy aliases: point at the ALREADY-fetched curated SVG content (same
  // bytes, additional key) — no extra network round trip.
  for (const [legacyId, tablerName] of Object.entries(LEGACY_ALIASES)) {
    const svg = iconMap.get(tablerName);
    if (svg === undefined) {
      throw new Error(`legacy alias ${legacyId} -> ${tablerName}: ${tablerName} was not fetched (not in CURATED)`);
    }
    if (iconMap.has(legacyId)) {
      throw new Error(`legacy alias id "${legacyId}" collides with a CURATED name — pick a different alias key`);
    }
    iconMap.set(legacyId, svg);
  }

  // The sentinel "no icon" entry (unchanged meaning from pre-P1b).
  iconMap.set("none", "");

  // Verify every pre-P1b legacy id resolves (the back-compat contract).
  for (const legacyId of PRE_P1B_LEGACY_IDS) {
    if (!iconMap.has(legacyId)) {
      throw new Error(`back-compat violation: pre-P1b legacy id "${legacyId}" has no entry in the generated map`);
    }
  }

  const license = (await fetchText(LICENSE_URL)).trim();

  const names = Array.from(iconMap.keys());

  const nameListTs = names.map((n) => `  ${tsStringLiteral(n)},`).join("\n");
  const mapEntriesTs = names
    .map((n) => `  ${tsStringLiteral(n)}: ${tsStringLiteral(iconMap.get(n) ?? "")},`)
    .join("\n");

  const licenseCommentBlock = license
    .split("\n")
    .map((line) => `// ${line}`.trimEnd())
    .join("\n");

  const header = `// AUTO-GENERATED by \`node scripts/build-icons.mjs\` — DO NOT EDIT BY HAND.
// Re-run the script (after deliberately bumping TABLER_TAG there) to refresh
// this file; the output is committed (build-time vendoring — zero runtime or
// npm dependency). Section Builder P1b Tabler icon pipeline (register PC-11).
//
// Source: ${TABLER_REPO} (the "outline" icon set).
// Pinned tag: ${TABLER_TAG} (${TABLER_REPO}/releases/tag/${TABLER_TAG})
//
// -----------------------------------------------------------------------
// Tabler Icons license (verbatim, fetched from the pinned tag's LICENSE):
// -----------------------------------------------------------------------
${licenseCommentBlock}
// -----------------------------------------------------------------------
//
// Every icon below is normalized to viewBox="0 0 24 24" fill="none"
// stroke="currentColor" stroke-width="2" stroke-linecap="round"
// stroke-linejoin="round" — deliberately NO width/height: leadgenIconSvg()
// injects those at emit, so ONE committed source string serves every size
// the product needs (20px leading-field icons, 48px card icons, ...).
// currentColor means an ancestor's CSS \`color\` paints the glyph — the
// .lg-card-icon token color and the §9.4 iconColor override now have real
// effect (the pre-P1b hand-drawn icons hardcoded stroke+size, so both were
// a no-op on them).
//
// Back-compat (zero content_json migration): the pre-P1b 12-value semantic
// vocabulary (location/calendar/dollar/phone/email/lock/person/home/car/
// shield/star/none) stays fully valid. calendar/phone/lock/home/car/shield/
// star already spell a real Tabler name (no alias needed); location/dollar/
// email/person are aliased to their Tabler equivalent (map-pin/
// currency-dollar/mail/user respectively — same SVG bytes, additional key).
// "none" is this product's own sentinel (not a Tabler icon), mapped to "".
`;

  const body = `
export const LEADGEN_ICON_NAMES = [
${nameListTs}
] as const;

export const LEADGEN_ICONS: Record<string, string> = {
${mapEntriesTs}
};

// Injects width/height (px) into a raw LEADGEN_ICONS entry at emit time — the
// map itself carries NO size so one source serves every call size. Returns
// "" for an unknown name or the "none" sentinel (empty-string entry).
export function leadgenIconSvg(name: string, sizePx: number): string {
  const svg = LEADGEN_ICONS[name];
  if (svg === undefined || svg === "") return "";
  return svg.replace("<svg ", \`<svg width="\${sizePx}" height="\${sizePx}" \`);
}
`;

  writeFileSync(OUT_PATH, header + body, "utf8");

  console.log(`build-icons: wrote ${OUT_PATH}`);
  console.log(`  tag: ${TABLER_TAG}`);
  console.log(`  curated names: ${uniqueCurated.length}`);
  console.log(`  legacy aliases: ${Object.keys(LEGACY_ALIASES).length} (${Object.keys(LEGACY_ALIASES).join(", ")})`);
  console.log(`  total map entries (curated + aliases + none): ${names.length}`);
  console.log(`  bytes written: ${Buffer.byteLength(header + body, "utf8")}`);
}

main().catch((err) => {
  console.error(`build-icons FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
