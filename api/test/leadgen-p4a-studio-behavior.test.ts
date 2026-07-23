// P4a Behavior-panel honesty (register PC-4-behavior). The studio must never
// offer a "Go to next" (auto_advance) the engine cannot honor — the operator's
// rule "the other choice must be disabled for the user". Two levels of proof,
// the leadgen-p3b-placement-exclusion discipline (derived from SOURCE, never
// assumed):
//   (1) SSR level: studioTypeMeta().auto_advance_click, for EVERY catalog type,
//       equals membership in AUTO_ADVANCE_CLICK_TYPES — a hand-edit divergence
//       between island projection and the save-time validator fails RED.
//   (2) EXECUTED-ISLAND level: sectionAutoAdvanceEligibility (+ its walkTree /
//       typeMeta / isContainerType deps) sliced from the ACTUAL SHIPPED island
//       bytes, run against studioMeta built from the REAL studioTypeMeta(), must
//       reach the SAME verdict as the server autoAdvanceEligibility per class.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { SECTION_STUDIO_SCRIPT, studioTypeMeta } from "../src/admin/leadgen/ui-section-studio";
import { COMPONENT_CATALOG, type ComponentType } from "../src/public/leadgen/components/registry";
import { AUTO_ADVANCE_CLICK_TYPES } from "../src/public/leadgen/components/content-schema";

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

describe("P4a Behavior honesty — SSR meta projection lockstep", () => {
  const meta = studioTypeMeta();
  it("studioTypeMeta().auto_advance_click is true for EXACTLY AUTO_ADVANCE_CLICK_TYPES, for EVERY catalog type", () => {
    for (const type of Object.keys(COMPONENT_CATALOG) as ComponentType[]) {
      expect(meta[type]?.auto_advance_click, `${type} auto_advance_click flag`).toBe(AUTO_ADVANCE_CLICK_TYPES.has(type));
    }
  });
  it("the click set is EXACTLY the 4 single-select click controls (§10 retired OtherGroupSelector)", () => {
    expect([...AUTO_ADVANCE_CLICK_TYPES].sort()).toEqual(
      ["ButtonAnswerGroup", "IconCardAnswerGrid", "ImageCardAnswerGrid", "TwoButtonYesNo"],
    );
  });
});

describe("P4a Behavior honesty — EXECUTED ISLAND sectionAutoAdvanceEligibility (shipped bytes)", () => {
  const meta = studioTypeMeta();
  // Build a sandbox with the REAL sliced island functions + a mutable `state`.
  const sandbox: Record<string, unknown> = { studioMeta: { types: meta }, state: { content: { components: [] } } };
  runInNewContext(
    [
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "typeMeta"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "isContainerType"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "walkTree"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "sectionAutoAdvanceEligibility"),
    ].join("\n"),
    sandbox,
  );
  const evalFor = (components: unknown[]): { eligible: boolean; reason: string } => {
    (sandbox["state"] as { content: { components: unknown[] } }).content.components = components;
    return runInNewContext("JSON.stringify(sectionAutoAdvanceEligibility())", sandbox) as never;
  };
  const parsed = (components: unknown[]) => JSON.parse(evalFor(components) as unknown as string) as { eligible: boolean; reason: string };

  const choice = (v: string) => ({ label: v, value: v, analytics_id: v });
  const yesno = (id: string, extra?: Record<string, unknown>) => ({ type: "TwoButtonYesNo", question_id: id, internal_field: id, ...extra });
  const buttons = (id: string) => ({ type: "ButtonAnswerGroup", question_id: id, internal_field: id, choices: [choice("a")] });
  const text = (id: string) => ({ type: "TextBlock", question_id: id, props: { role: "body", text: "t" } });

  it("one single-select click producer (+ decorative TextBlocks) → ELIGIBLE", () => {
    expect(parsed([text("hd"), yesno("q1"), text("legal")]).eligible).toBe(true);
  });
  it("a nested (container) single producer → ELIGIBLE (walkTree flattens)", () => {
    const stack = { type: "Stack", question_id: "st", children: [yesno("q1")] };
    expect(parsed([stack]).eligible).toBe(true);
  });
  it("two producers → multiple_producers", () => {
    const r = parsed([yesno("a"), buttons("b")]);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("multiple_producers");
  });
  it("dropdown only (no click) → not_click_to_answer", () => {
    const r = parsed([{ type: "DropdownQuestion", question_id: "q", internal_field: "q", choices: [choice("a")] }]);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("not_click_to_answer");
  });
  it("multi-choice → multi_select", () => {
    expect(parsed([{ type: "MultiChoiceCardGroup", question_id: "q", internal_field: "q", choices: [choice("a")] }]).reason).toBe("multi_select");
  });
  it("the sole producer is conditional → conditional_producer", () => {
    expect(parsed([yesno("q1", { conditional: { when: "x", op: "eq", value: "y" } })]).reason).toBe("conditional_producer");
  });
  it("chrome-only section → no_producers", () => {
    expect(parsed([text("hd")]).reason).toBe("no_producers");
  });
});
