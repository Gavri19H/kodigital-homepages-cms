// P1b (Section Builder product-core remediation, register PC-11) — Tabler
// icon pipeline unit tests. These exercise icons.generated.ts's build-time-
// vendored map + leadgenIconSvg() emit function DIRECTLY (independent of any
// specific renderer — presets.ts's own consumption is covered by
// leadgen-r3a-consumption.test.ts/leadgen-components-render.test.ts), plus
// the content-schema enum<->map correspondence and the legacy back-compat
// contract (the 11 pre-Tabler semantic ids must keep resolving with ZERO
// content_json migration).
import { describe, expect, it } from "vitest";
import {
  LEADGEN_ICON_NAMES,
  LEADGEN_ICONS,
  leadgenIconSvg,
} from "../src/public/leadgen/components/icons.generated";
import { LEADGEN_FIELD_LEADING_ICONS } from "../src/public/leadgen/components/content-schema";

// The pre-P1b 12-value semantic-id vocabulary (content-schema.ts history —
// R3 S2-8/E1-NEW-9/U9). Every one of these must still resolve.
const PRE_TABLER_LEGACY_IDS = [
  "location",
  "calendar",
  "dollar",
  "phone",
  "email",
  "lock",
  "person",
  "home",
  "car",
  "shield",
  "star",
  "none",
];

// The 4 legacy ids whose spelling differs from their Tabler equivalent (the
// other 7 — calendar/phone/lock/home/car/shield/star — already spell a real
// Tabler name, so they are not aliases; they are just curated names that
// happen to equal a legacy id).
const ALIAS_PAIRS: Array<[legacyId: string, modernName: string]> = [
  ["location", "map-pin"],
  ["dollar", "currency-dollar"],
  ["email", "mail"],
  ["person", "user"],
];

describe("icons.generated.ts — Tabler icon pipeline (P1b register PC-11)", () => {
  it("LEADGEN_ICON_NAMES and LEADGEN_ICONS keys correspond exactly (no orphan name, no orphan svg entry)", () => {
    expect(Object.keys(LEADGEN_ICONS).sort()).toEqual([...LEADGEN_ICON_NAMES].sort());
  });

  it("content-schema's LEADGEN_FIELD_LEADING_ICONS enum IS icons.generated's LEADGEN_ICON_NAMES (single source of truth, no drift possible)", () => {
    expect([...LEADGEN_FIELD_LEADING_ICONS].sort()).toEqual([...LEADGEN_ICON_NAMES].sort());
  });

  it("(a) every enum name resolves to an svg containing currentColor, with NO hardcoded width/height in the raw map entry", () => {
    for (const name of LEADGEN_ICON_NAMES) {
      const svg = LEADGEN_ICONS[name];
      expect(svg, `${name} has a map entry`).not.toBeUndefined();
      if (name === "none") {
        expect(svg, "the 'none' sentinel is the empty string").toBe("");
        continue;
      }
      expect(svg, `${name} is non-empty`).not.toBe("");
      expect(svg, `${name} uses stroke="currentColor"`).toContain('stroke="currentColor"');
      expect(svg, `${name} keeps the 24x24 viewBox`).toContain('viewBox="0 0 24 24"');
      expect(svg, `${name} carries no width attribute in the raw map entry`).not.toMatch(/\swidth="/);
      expect(svg, `${name} carries no height attribute in the raw map entry`).not.toMatch(/\sheight="/);
    }
  });

  it("(b) leadgenIconSvg(name, 48) emits width=\"48\" height=\"48\" for every non-'none' name", () => {
    for (const name of LEADGEN_ICON_NAMES) {
      if (name === "none") {
        expect(leadgenIconSvg(name, 48), "none stays empty at any size").toBe("");
        continue;
      }
      const sized = leadgenIconSvg(name, 48);
      expect(sized, `${name} sized 48`).toContain('width="48" height="48"');
      expect(sized, `${name} keeps currentColor after sizing`).toContain('stroke="currentColor"');
    }
  });

  it("leadgenIconSvg injects the EXACT requested size (20 vs 48 differ, not a fixed constant)", () => {
    const at20 = leadgenIconSvg("home", 20);
    const at48 = leadgenIconSvg("home", 48);
    expect(at20).toContain('width="20" height="20"');
    expect(at48).toContain('width="48" height="48"');
    expect(at20).not.toContain('width="48"');
    expect(at48).not.toContain('width="20"');
  });

  it("leadgenIconSvg returns '' for an unrecognized name (defensive default, matches presets.ts's hasOwnProperty gate)", () => {
    expect(leadgenIconSvg("not-a-real-icon-xyz", 48)).toBe("");
  });

  it("(c) the 11 pre-Tabler legacy ids (+ 'none') all resolve — zero content_json migration", () => {
    for (const id of PRE_TABLER_LEGACY_IDS) {
      expect(LEADGEN_ICON_NAMES as readonly string[], `${id} is a valid enum member`).toContain(id);
      const sized = leadgenIconSvg(id, 20);
      if (id === "none") {
        expect(sized, "none renders nothing").toBe("");
      } else {
        expect(sized, `${id} renders a real sized icon`).toContain('width="20" height="20"');
        expect(sized, `${id} is a currentColor icon`).toContain('stroke="currentColor"');
      }
    }
  });

  it("the 4 aliased legacy ids render byte-identical SVG to their modern Tabler equivalent (same asset, additional key)", () => {
    for (const [legacyId, modernName] of ALIAS_PAIRS) {
      expect(LEADGEN_ICONS[modernName], `${modernName} is itself a curated entry`).not.toBeUndefined();
      expect(LEADGEN_ICONS[legacyId], `${legacyId} byte-identical to ${modernName}`).toBe(LEADGEN_ICONS[modernName]);
    }
  });

  it("the 7 legacy ids that already spell a real Tabler name need no alias (calendar/phone/lock/home/car/shield/star)", () => {
    for (const id of ["calendar", "phone", "lock", "home", "car", "shield", "star"]) {
      expect(LEADGEN_ICON_NAMES as readonly string[], `${id} is curated directly`).toContain(id);
    }
  });

  it("the curated set grew well past the pre-Tabler 12 (curated ~100+ Tabler subset)", () => {
    expect(LEADGEN_ICON_NAMES.length).toBeGreaterThan(90);
  });

  it("no duplicate names in the curated set", () => {
    expect(new Set(LEADGEN_ICON_NAMES).size).toBe(LEADGEN_ICON_NAMES.length);
  });
});
