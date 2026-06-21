// T15 [C10] design-contract-values: publicCss carries the EXACT pinned
// values from docs/design-contract.md §11 for ChipRail + Trending:
//   - `.cat-chip`: min-width 168px, gap 16px; hover lifts 2px and switches
//     the border to var(--tw-brand)
//   - `.trending-section`: background var(--tw-ink) (dark, full-bleed)
//   - `.pulse-dot`: 12px circle, color var(--tw-brand), 1.6s pulse keyframe
// T16 [C11] adds breakpoint parity: all 8 contract breakpoints must exist
// as @media (max-width:...) rules — a bare pixel value elsewhere in the
// sheet can never satisfy the contract.
// Assertions extract each selector's declaration block so a value match in
// an unrelated rule can never satisfy the contract.

import { describe, it, expect } from "vitest";
import { publicCss } from "../src/public/assets/public-css";

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`);
  const match = publicCss.match(re);
  expect(match, `publicCss has a rule for selector "${selector}"`).not.toBeNull();
  return match === null ? "" : (match[1] ?? "");
}

describe("design-contract-values", () => {
  it(".cat-chip pins contract min-width 168px and gap 12px", () => {
    const decl = declarations(".cat-chip");
    expect(decl).toContain("min-width: 168px");
    // RESCUE-4: the claude.ai design `.cat-chip` gap is 12px (was 16px); the
    // chip is a rounded-RECT (border-radius var(--tw-radius)=10px), not a pill.
    expect(decl).toContain("gap: 12px");
  });

  it(".cat-chip:hover lifts 2px and switches border to var(--tw-brand)", () => {
    const decl = declarations(".cat-chip:hover");
    expect(decl).toContain("translateY(-2px)");
    expect(decl).toContain("border-color: var(--tw-brand)");
  });

  it(".trending-section pins contract dark background var(--tw-ink)", () => {
    const decl = declarations(".trending-section");
    expect(decl).toContain("background: var(--tw-ink)");
  });

  it(".pulse-dot pins contract color var(--tw-brand), 12px, 1.6s pulse", () => {
    const decl = declarations(".pulse-dot");
    expect(decl).toContain("background: var(--tw-brand)");
    expect(decl).toContain("width: 12px");
    expect(decl).toContain("height: 12px");
    expect(publicCss).toContain("animation: pulse 1.6s ease-out infinite");
  });

  it("publicCss pins all 8 contract breakpoints as max-width media queries", () => {
    const breakpoints = [1280, 1080, 980, 880, 800, 760, 560, 480];
    for (const bp of breakpoints) {
      expect(
        publicCss,
        `publicCss has a @media (max-width:${bp}px) rule`,
      ).toContain(`@media (max-width:${bp}px)`);
    }
  });
});
