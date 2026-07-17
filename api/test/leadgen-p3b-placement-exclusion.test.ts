// Section Builder product-core P3b — CONDUCTOR FIX lockstep gate (register
// PC-2). content-schema.ts exports LEADGEN_PLACEMENT_EXCLUDED_TYPES
// (ContinueButton/AutoAdvanceButton — their position is Quote-Builder-owned,
// the §8.5b/§11.5 continue-placement model, so `layout` is REJECTED on both
// at save time regardless of their catalog scope "unit"). The P3b studio
// island's placementEligible() must mirror this EXACT exclusion — the studio
// must never offer beside-zones/placement controls the save-time validator
// would 400 on.
//
// Two levels of proof, the SAME "derived from SOURCE, not assumed" discipline
// leadgen-r3a-choice-fields.test.ts established for CHOICE_FIELD_CONSUMPTION:
//   (1) SSR level: studioTypeMeta()'s placement_excluded flag, for EVERY
//       catalog type, equals membership in the exported const — a silent
//       hand-edit divergence between the two fails this test.
//   (2) EXECUTED-ISLAND level: placementEligible + its typeMeta dependency,
//       sliced from the ACTUAL SHIPPED SECTION_STUDIO_SCRIPT bytes (never a
//       test re-implementation), run against studioMeta.types built from the
//       REAL studioTypeMeta() output — so a typo'd key name inside the island
//       fails RED even though the SSR-level assertion above would still pass.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { SECTION_STUDIO_SCRIPT, studioTypeMeta } from "../src/admin/leadgen/ui-section-studio";
import { COMPONENT_CATALOG, type ComponentType } from "../src/public/leadgen/components/registry";
import { LEADGEN_PLACEMENT_EXCLUDED_TYPES } from "../src/public/leadgen/components/content-schema";

// Slice ONE top-level `function NAME(...) { ... }` out of the shipped island
// text via brace-depth counting (the leadgen-r3a-choice-fields /
// leadgen-section-studio-ui.test.ts idiom) — never a hand-copied
// re-implementation of the function under test.
function sliceIslandFunction(script: string, name: string): string {
  const marker = `function ${name}(`;
  const start = script.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing island function ${name}`);
}

describe("P3b CONDUCTOR FIX — placement-exclusion lockstep (LEADGEN_PLACEMENT_EXCLUDED_TYPES)", () => {
  const excludedSet = new Set<string>(LEADGEN_PLACEMENT_EXCLUDED_TYPES);
  const meta = studioTypeMeta();

  it("the exported set is EXACTLY {ContinueButton, AutoAdvanceButton} (mirrors content-schema.ts's own lockstep guard)", () => {
    expect([...LEADGEN_PLACEMENT_EXCLUDED_TYPES].sort()).toEqual(["AutoAdvanceButton", "ContinueButton"]);
  });

  it("SSR level: studioTypeMeta().placement_excluded is true for EXACTLY the exported set, for EVERY catalog type", () => {
    for (const type of Object.keys(COMPONENT_CATALOG) as ComponentType[]) {
      expect(meta[type]?.placement_excluded, `${type} placement_excluded flag`).toBe(excludedSet.has(type));
    }
  });

  it("EXECUTED ISLAND: placementEligible (sliced from the SHIPPED script) returns false for both excluded types, true for an ordinary unit-scope type, and still false for a frame-scope type (pre-existing rule, unchanged) — driven by the REAL studioTypeMeta() output, not a hand-built stub", () => {
    const sandbox: Record<string, unknown> = { studioMeta: { types: meta } };
    runInNewContext(
      [sliceIslandFunction(SECTION_STUDIO_SCRIPT, "typeMeta"), sliceIslandFunction(SECTION_STUDIO_SCRIPT, "placementEligible")].join("\n"),
      sandbox,
    );
    const placementEligible = sandbox["placementEligible"] as (node: { type: string }) => boolean;
    expect(placementEligible({ type: "ContinueButton" }), "ContinueButton is NOT placement-eligible").toBe(false);
    expect(placementEligible({ type: "AutoAdvanceButton" }), "AutoAdvanceButton is NOT placement-eligible").toBe(false);
    expect(placementEligible({ type: "ButtonAnswerGroup" }), "an ordinary unit-scope type IS placement-eligible").toBe(true);
    expect(placementEligible({ type: "HeaderBar" }), "a frame-scope type is NOT placement-eligible (pre-existing rule, unchanged)").toBe(false);
  });
});
