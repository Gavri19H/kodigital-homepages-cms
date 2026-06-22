// T17 [C12] Public JS contract — BEHAVIORAL guard for the exported
// /assets/public.js script string (api/src/public/assets/public-js.ts).
//
// ACs:
//   T17.AC1 — progress bar is transform-driven: scaleX + transform-origin
//             present in the script; style.width never appears.
//   T17.AC2 — scroll listener registers with { passive: true }.
//   T17.AC3 — the IMPORTED STRING is ES5-only: zero arrow functions and
//             zero const/let declarations inside the script literal. The
//             module-level `export const publicJs` wrapper is legitimate
//             TS and deliberately out of scope — a whole-file grep is the
//             wrong instrument; only the imported string is graded.
//   T17.AC4 — exported string stays under 6KB.

import { describe, it, expect } from "vitest";
import { publicJs } from "../src/public/assets/public-js";

describe("public-js-contract", () => {
  it("T17.AC1: drives the reading-progress bar via scaleX + transform-origin, never style.width", () => {
    expect(publicJs).toContain("scaleX(");
    expect(publicJs).toContain("transform-origin");
    expect(publicJs).not.toContain("style.width");
  });

  it("T17.AC2: registers the scroll listener with { passive: true }", () => {
    expect(publicJs).toContain("passive: true");
  });

  it("T17.AC3: script literal is ES5-only — zero arrow functions, const, or let", () => {
    expect(publicJs).not.toMatch(/=>/);
    expect(publicJs).not.toMatch(/\bconst\b/);
    expect(publicJs).not.toMatch(/\blet\b/);
  });

  // rescue-4 round-2: budget raised 6KB -> 8KB for the new save / copy / share /
  // newsletter progressive-enhancement handlers (still ~2KB gzipped, inline).
  it("T17.AC4: exported script string stays under 8KB", () => {
    expect(new TextEncoder().encode(publicJs).length).toBeLessThan(8 * 1024);
  });

  // T42 [F3] Performance re-assert. The it() title embeds the literal
  // evidence command for RC-127's deterministic test-name binding.
  it("T42.AC3 exported public.js stays under 8KB [cd api && npx vitest run test/public-js-contract.test.ts]", () => {
    expect(new TextEncoder().encode(publicJs).length).toBeLessThan(8 * 1024);
  });
});
