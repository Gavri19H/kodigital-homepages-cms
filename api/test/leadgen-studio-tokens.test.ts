// LeadGen Section STUDIO v3.1 — admin design-token module lock (contract §3 +
// §3.1b + Appendix B). These assertions tie every token to the BYTE-EXACT
// committed golden master, so any drift between the token module and the
// design source fails the build. The golden is a frozen in-repo design asset;
// resolved relative to THIS test file (never a hardcoded/foreign path).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  STUDIO_COLOR,
  STUDIO_COLOR_PLACEMENT,
  STUDIO_TYPE,
  STUDIO_RADIUS,
  STUDIO_GEOMETRY,
  STUDIO_TOKENS,
} from "../src/admin/leadgen/studio-tokens";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = readFileSync(
  join(HERE, "..", "..", "docs", "leadgen", "redesign-contract-v3", "golden", "golden-master-source.dc.html"),
  "utf8",
);

describe("studio-tokens · §3 color palette", () => {
  it("every color token is a 6-digit hex", () => {
    for (const [k, v] of Object.entries(STUDIO_COLOR)) {
      expect(/^#[0-9A-Fa-f]{6}$/.test(v), `${k}=${v}`).toBe(true);
    }
  });

  it("core §3.1 hexes match the contract exactly (incl. lowercase navy-hover)", () => {
    expect(STUDIO_COLOR.ink).toBe("#1A1F36");
    expect(STUDIO_COLOR.inkStrong).toBe("#111726");
    expect(STUDIO_COLOR.navy).toBe("#1B3A5C");
    expect(STUDIO_COLOR.navyHover).toBe("#16324f"); // byte-exact lowercase
    expect(STUDIO_COLOR.navyTint).toBe("#EAF0F6");
    expect(STUDIO_COLOR.accent).toBe("#F5C518");
    expect(STUDIO_COLOR.success).toBe("#0E7C3A");
    expect(STUDIO_COLOR.infoBlue).toBe("#2E6BB0");
    expect(STUDIO_COLOR.warn).toBe("#B8860B");
    expect(STUDIO_COLOR.danger).toBe("#B23A2C");
    expect(STUDIO_COLOR.appBg).toBe("#EDF0F4");
    expect(STUDIO_COLOR.page).toBe("#D9DEE6");
  });

  it("every named palette hex appears byte-for-byte in the committed golden", () => {
    // The golden IS the pixel spec; EVERY STUDIO_COLOR entry must be a literal
    // it uses somewhere (auto-iterated so new tokens are covered without a
    // manually-maintained duplicate list — the failure mode that produced two
    // real mislabeled hexes during Phase B authoring).
    for (const [key, hex] of Object.entries(STUDIO_COLOR)) {
      expect(GOLDEN.includes(hex), `${key}=${hex} not found in golden`).toBe(true);
    }
  });

  it("no two STUDIO_COLOR keys silently share one name for two different hexes", () => {
    // Reverse-index: collect which keys map to which hex; just a sanity count
    // that the palette has no accidental duplicate KEY (TS object literals
    // can't have duplicate keys, but this guards a future refactor that might
    // merge the const differently).
    const entries = Object.entries(STUDIO_COLOR);
    const keys = entries.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("studio-tokens · §3.1b placement map", () => {
  it("covers exactly the 9 disambiguated shades, each a byte-present golden literal", () => {
    const keys = Object.keys(STUDIO_COLOR_PLACEMENT).sort();
    expect(keys).toEqual(
      ["#5A6470", "#6B7486", "#8A93A3", "#98A1B0", "#9BA3B1", "#E4E8EF", "#E1E6EE", "#EEF1F6", "#E7EBF1"].sort(),
    );
    for (const [hex, uses] of Object.entries(STUDIO_COLOR_PLACEMENT)) {
      expect(GOLDEN.includes(hex), `golden missing ${hex}`).toBe(true);
      expect(uses.length).toBeGreaterThan(0);
    }
  });
});

describe("studio-tokens · Appendix B geometry (parity to golden literals)", () => {
  it("region heights / rail widths / unit column match Appendix B", () => {
    expect(STUDIO_GEOMETRY.topBarHeight).toBe(56);
    expect(STUDIO_GEOMETRY.canvasToolbarHeight).toBe(46);
    expect(STUDIO_GEOMETRY.bottomDrawerHeight).toBe(42);
    expect(STUDIO_GEOMETRY.leftLibraryWidth).toBe(292);
    expect(STUDIO_GEOMETRY.rightInspectorWidth).toBe(344);
    expect(STUDIO_GEOMETRY.themesListWidth).toBe(300);
    expect(STUDIO_GEOMETRY.themesAbPanelWidth).toBe(320);
    expect(STUDIO_GEOMETRY.unitColumnWidth).toBe(600);
  });

  it("geometry values are the actual golden style-string literals", () => {
    const g = STUDIO_GEOMETRY;
    // region heights (golden :30 / :264 / :371)
    expect(GOLDEN.includes(`height:${g.topBarHeight}px`)).toBe(true);
    expect(GOLDEN.includes(`height:${g.canvasToolbarHeight}px`)).toBe(true);
    expect(GOLDEN.includes(`height:${g.bottomDrawerHeight}px`)).toBe(true);
    // rails + unit column (golden :103 / :296)
    expect(GOLDEN.includes(`flex:0 0 ${g.leftLibraryWidth}px`)).toBe(true);
    expect(GOLDEN.includes(`width:${g.unitColumnWidth}px`)).toBe(true);
    // dot grid pitch (golden :295)
    expect(GOLDEN.includes(`${g.dotGrid.pitch} ${g.dotGrid.pitch}`)).toBe(true);
    // question unit card (golden :308)
    expect(GOLDEN.includes(`padding:${g.questionCard.padding}`)).toBe(true);
    expect(GOLDEN.includes(g.questionCard.shadow)).toBe(true);
    expect(GOLDEN.includes(`border-radius:${g.questionCard.radius}px`)).toBe(true);
    // tile padding (golden :122)
    expect(GOLDEN.includes(`padding:${g.tile.padding}`)).toBe(true);
    // 8-handle geometry (golden :338–:345)
    expect(GOLDEN.includes(`left:${g.selection.handleSideOffset}px`)).toBe(true);
    expect(GOLDEN.includes(`top:${g.selection.handleRows.mid}px`)).toBe(true);
    expect(GOLDEN.includes(`top:${g.selection.handleRows.bottom}px`)).toBe(true);
    // name tag + custom badge radii (golden :331 / :336)
    expect(GOLDEN.includes(`border-radius:${g.selection.nameTag.radius}`)).toBe(true);
    expect(GOLDEN.includes(`border-radius:${g.selection.customBadge.radius}`)).toBe(true);
  });
});

describe("studio-tokens · type + radius + aggregate", () => {
  it("§3.2 font families are the OFL golden families", () => {
    expect(STUDIO_TYPE.family.inter).toContain("Inter");
    expect(STUDIO_TYPE.family.newsreader).toContain("Newsreader");
    expect(STUDIO_TYPE.family.robotoMono).toContain("Roboto Mono");
    // canvas funnel headline is 31px Newsreader 600 (§3.2)
    expect(STUDIO_TYPE.size.canvasHeadline).toBe(31);
  });

  it("§3.3 radii set", () => {
    expect(STUDIO_RADIUS.control).toBe(8);
    expect(STUDIO_RADIUS.tile).toBe(9);
    expect(STUDIO_RADIUS.questionCard).toBe(16);
    expect(STUDIO_RADIUS.continue).toBe(11);
    expect(STUDIO_RADIUS.pill).toBe(20);
    expect(STUDIO_RADIUS.handle).toBe(3);
  });

  it("aggregate re-exports the same references", () => {
    expect(STUDIO_TOKENS.color).toBe(STUDIO_COLOR);
    expect(STUDIO_TOKENS.geometry).toBe(STUDIO_GEOMETRY);
    expect(STUDIO_TOKENS.type).toBe(STUDIO_TYPE);
    expect(STUDIO_TOKENS.radius).toBe(STUDIO_RADIUS);
  });
});
