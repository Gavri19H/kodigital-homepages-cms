// Section Builder v3.1 REMEDIATION — phase R2 (canvas interaction real).
// PURE-LOGIC vitest for the canvas layer changes that do NOT need a live
// browser (the real-gesture proofs live in the firefox lane,
// api/test-ui/leadgen-canvas-interactions.gesture.spec.ts). Kept in a SEPARATE
// file from leadgen-section-studio-ui.test.ts to avoid ownership collision
// (dispatch instruction) — its own tiny island-slicer mirrors that suite's
// vm-probe idiom.
//
// Covers: (1) the HEIGHT drag snap/clamp math [4,600]·grid-4, distinct from
// WIDTH's [200,600] — every value it emits is schema-legal per the REAL
// validateSectionContent (no drift between the island's clamp and the server's
// invalid_size_override gate); (2) the resize state-machine's width+height
// branches ship; (3) the Spacer toolbar layout cluster is no longer EMPTY
// (E2-NEW-9); (4) the selection overlay is MEASURED (getBoundingClientRect),
// not the old hardcoded 66px/-11/19/49 geometry; (5) the height Custom chip +
// Reset twin + applyCanvasDecoration on the height/corners/border setters.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SECTION_STUDIO_SCRIPT,
  renderSectionStudio,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

// --- tiny island slicer (mirrors the studio-ui vm-probe) ---------------------
function sliceFn(name: string): string {
  const marker = `function ${name}(`;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = SECTION_STUDIO_SCRIPT.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    if (SECTION_STUDIO_SCRIPT[i] === "{") depth += 1;
    else if (SECTION_STUDIO_SCRIPT[i] === "}") {
      depth -= 1;
      if (depth === 0) return SECTION_STUDIO_SCRIPT.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}
function sliceVarLine(prefix: string): string {
  const start = SECTION_STUDIO_SCRIPT.indexOf(prefix);
  expect(start, `island var line "${prefix}" present`).toBeGreaterThan(-1);
  const end = SECTION_STUDIO_SCRIPT.indexOf(";", start);
  return SECTION_STUDIO_SCRIPT.slice(start, end + 1);
}
// Eval the size constants + both snap functions in one sandbox, exposed for
// direct calling — this runs the SHIPPED island bytes, not a re-typed copy.
function sizeSandbox(): {
  snapHeightCustomPx(px: number): number;
  snapWidthCustomPx(px: number): number;
} {
  const src = [
    sliceVarLine("var WIDTH_PX_MIN"),
    sliceVarLine("var HEIGHT_PX_MIN"),
    sliceFn("snapWidthCustomPx"),
    sliceFn("snapHeightCustomPx"),
    "({ snapHeightCustomPx: snapHeightCustomPx, snapWidthCustomPx: snapWidthCustomPx })",
  ].join("\n");
  return runInNewContext(src, {}) as ReturnType<typeof sizeSandbox>;
}

// --- R2 adversarial-review MAJOR fix #1: independent presets.ts derivation --
// Derives the SIZE-CONSUMING ComponentType set directly from presets.ts
// SOURCE — never copied from the island or hand-typed — so this test is the
// drift-proof PIN the review asked for: if R3 widens which renderers consume
// design_overrides.size, THIS test fails until the island's SIZE_CONSUMING_
// TYPES widens in lockstep (the island can never silently drift stale).
function bracedBody(src: string, fnStartIdx: number): string | null {
  if (fnStartIdx < 0) return null;
  const open = src.indexOf("{", fnStartIdx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(fnStartIdx, i + 1);
    }
  }
  return null;
}
function derivePresetsSizeConsumingTypes(): string[] {
  const presetsPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "public",
    "leadgen",
    "components",
    "presets.ts",
  );
  const src = readFileSync(presetsPath, "utf8");
  // Step 1: every "function renderXxx(" whose OWN brace-bounded body (not a
  // naive "slice to the next function" — that leaks unrelated file content
  // for any function with no sibling before the next render* declaration)
  // calls one of the design_overrides.size call sites. The R2 set was the three
  // .lg-input-family sites (fieldStyleAttr/fieldSizeStyle/renderTextInput). R3
  // widened consumption to the choice/button/card/dropdown renderers, which
  // apply the per-ITEM size axis via choiceItemStyle( (buttons/cards/multi/other-
  // group + renderCardGrid itself) and the dropdown <select> via fieldStyleAttr(;
  // the two icon/image grid wrappers delegate to renderCardGrid(. R2 P5 S5a
  // (owner D3): renderAddressAutocompleteQuestion itself became a thin
  // dispatcher onto renderAddressFieldSet (the composite-by-default fix), the
  // SAME "helper renderer other renderers delegate size-styling through"
  // shape renderTextInput/renderCardGrid already are here — so
  // renderAddressFieldSet( joins them for the identical reason. Adding
  // choiceItemStyle(, renderCardGrid( and renderAddressFieldSet( keeps the
  // derivation SOURCE-DERIVED and drift-proof: any future renderer that
  // consumes size through one of these six call sites is caught.
  const consumingFnNames = new Set<string>();
  const fnMatches = [...src.matchAll(/(?:export )?function (render\w+)\(/g)];
  for (const fm of fnMatches) {
    const body = bracedBody(src, fm.index ?? -1);
    if (body === null) continue;
    if (
      body.includes("fieldStyleAttr(") ||
      body.includes("fieldSizeStyle(") ||
      body.includes("renderTextInput(") ||
      body.includes("choiceItemStyle(") ||
      body.includes("renderCardGrid(") ||
      body.includes("renderAddressFieldSet(")
    ) {
      consumingFnNames.add(fm[1]!);
    }
  }
  expect(consumingFnNames.size, "sanity: derivation must find at least the known consumers").toBeGreaterThanOrEqual(8);
  // Step 2: map ComponentType -> render function via the ONE renderComponent
  // dispatch switch's "case Type: ... return renderFn(" pairs.
  const caseMatches = [...src.matchAll(/case "(\w+)":[\s\S]{0,200}?return (render\w+)\(/g)];
  const typeToFn = new Map<string, string>();
  for (const cm of caseMatches) {
    if (!typeToFn.has(cm[1]!)) typeToFn.set(cm[1]!, cm[2]!);
  }
  expect(typeToFn.size, "sanity: the dispatch switch must resolve many cases").toBeGreaterThan(20);
  const consumingTypes: string[] = [];
  for (const [type, fn] of typeToFn) {
    if (consumingFnNames.has(fn)) consumingTypes.push(type);
  }
  return consumingTypes.sort();
}
function islandSizeConsumingTypes(): string[] {
  // runInNewContext with a plain object CONTEXT turns a top-level `var`
  // declaration into a property of that object (the sizeSandbox() idiom
  // above) — a `var` statement cannot be wrapped in `(...)` as an expression.
  const sandbox: Record<string, unknown> = {};
  runInNewContext(sliceVarLine("var SIZE_CONSUMING_TYPES"), sandbox);
  const obj = sandbox["SIZE_CONSUMING_TYPES"] as Record<string, number>;
  return Object.keys(obj)
    .filter((k) => obj[k] === 1)
    .sort();
}

describe("R2 adversarial-review MAJOR fix #1 — the SIZE-CONSUMING type predicate is DERIVED, not assumed, and drift-proofed", () => {
  it("the island's SIZE_CONSUMING_TYPES equals the set independently derived from presets.ts source (a future R3 widening of consumption fails THIS test until the island predicate widens in lockstep)", () => {
    const fromPresets = derivePresetsSizeConsumingTypes();
    const fromIsland = islandSizeConsumingTypes();
    expect(fromIsland).toEqual(fromPresets);
  });

  it("the derived/pinned set is exactly the 15 types expected (the 8 text-input/Currency/Address family + the 7 R3 choice/button/card/dropdown renderers; the grid + OtherGroupSelector retired in the rework §10)", () => {
    expect(islandSizeConsumingTypes()).toEqual(
      [
        // R2 baseline — the .lg-input family
        "AddressAutocompleteQuestion",
        "CurrencyInputQuestion",
        "DateQuestion",
        "EmailInputQuestion",
        "FreeTextQuestion",
        "NumberInputQuestion",
        "PhoneInputQuestion",
        "ZIPInputQuestion",
        // R3 widening — the choice/button/card/dropdown renderers now consume
        // design_overrides.size/.corners/.border_color (presets.ts). Rework §10:
        // the grid + OtherGroupSelector size-consuming render legs were removed
        // from presets.ts, so they drop from this lockstep set (island + derived).
        "ButtonAnswerGroup",
        "DropdownQuestion",
        "IconCardAnswerGrid",
        "ImageCardAnswerGrid",
        "MultiChoiceCardGroup",
        "SearchableDropdownQuestion",
        "TwoButtonYesNo",
      ].sort(),
    );
  });

  it("decorateFieldSelection gates BOTH the resize handles and the Custom badge on sizeConsuming; a non-consuming type gets buildInertHandle (no cursor/pointer-events:auto/mousedown/locators), never buildHandle", () => {
    const deco = sliceFn("decorateFieldSelection");
    expect(deco).toContain("var sizeConsuming = !!(node && isSizeConsumingType(node.type));");
    // the Custom badge is gated
    expect(deco).toMatch(/if \(sizeConsuming && \(customPxW !== null \|\| customPxH !== null\)\)/);
    // every one of the 8 handle builds branches sizeConsuming ? buildHandle(...) : buildInertHandle(...)
    const handleTernaries = [...deco.matchAll(/sizeConsuming \? buildHandle\([^)]*\) : buildInertHandle\([^)]*\)/g)];
    expect(handleTernaries.length, "all 8 handle positions must branch on sizeConsuming").toBe(8);
  });

  it("buildInertHandle ships the SAME fixed appearance (11x11/radius-3/navy) but pointer-events:none, no cursor, and none of the grabbable locators", () => {
    const inert = sliceFn("buildInertHandle");
    expect(inert).toContain(
      "width:11px;height:11px;border-radius:3px;background:#1B3A5C;border:2px solid #1B3A5C;box-sizing:border-box;pointer-events:none",
    );
    expect(inert).not.toContain("cursor:");
    expect(inert).not.toContain("pointer-events:auto");
    expect(inert).not.toContain("data-field-resize-handle");
    expect(inert).not.toContain("data-fr-wside");
    expect(inert).not.toContain("data-fr-hside");
    expect(inert).not.toContain("data-width-handle");
    expect(inert).not.toContain("addEventListener");
  });

  it("fake-DOM: applyCanvasDecoration on a non-consuming type (NameFieldsGroup — R3 made ButtonAnswerGroup consuming, so the non-consuming example moved to a still-non-consuming field type) renders handles with NO resize locator and NO listener wired — a drag attempt has nothing to grab", () => {
    // Minimal fake-DOM harness: enough surface for decorateFieldSelection's
    // measurement + child-append calls, none of the full studio-ui vm-probe's
    // machinery (this file intentionally stays lightweight, per its own header).
    interface FakeEl {
      tagName: string;
      attrs: Record<string, string>;
      // ensureSelectionWrap/the outline/tag/badge set appearance via
      // el.style.cssText = "…"; buildHandle/buildInertHandle instead use
      // el.setAttribute('style', "…") — BOTH idioms appear in
      // decorateFieldSelection's call graph, so this fake element supports
      // both, and getAttribute('style') (used by this test's handle
      // assertions below) reads whichever path a given element actually used.
      style: { cssText: string };
      children: FakeEl[];
      listeners: string[];
      parentNode: FakeEl | null;
      getBoundingClientRect(): { left: number; top: number; width: number; height: number };
      getAttribute(name: string): string | null;
      setAttribute(name: string, value: string): void;
      appendChild(child: FakeEl): FakeEl;
      addEventListener(type: string): void;
      querySelector(): null;
    }
    function fakeEl(tag: string): FakeEl {
      const el: FakeEl = {
        tagName: tag.toUpperCase(),
        attrs: {},
        style: { cssText: "" },
        children: [],
        listeners: [],
        parentNode: null,
        getBoundingClientRect() {
          return { left: 20, top: 20, width: 452, height: 54 };
        },
        getAttribute(name) {
          if (name === "style" && el.style.cssText !== "") return el.style.cssText;
          return el.attrs[name] ?? null;
        },
        setAttribute(name, value) {
          el.attrs[name] = value;
        },
        appendChild(child) {
          child.parentNode = el;
          el.children.push(child);
          return child;
        },
        addEventListener(type) {
          el.listeners.push(type);
        },
        querySelector() {
          return null;
        },
      };
      return el;
    }
    const fieldEl = fakeEl("div"); // NameFieldsGroup's node is a container div, not a bare input
    const node = { type: "NameFieldsGroup", design_overrides: {} };
    const src = [
      "function frameCreate(tag) { return fakeElFactory(tag); }",
      sliceVarLine("var SIZE_CONSUMING_TYPES"),
      sliceFn("isSizeConsumingType"),
      sliceVarLine("var BARE_INPUT_FIELD_TYPES"),
      sliceFn("isBareInputFieldType"),
      sliceFn("ensureSelectionWrap"),
      sliceFn("currentCustomWidthPx"),
      sliceFn("currentCustomHeightPx"),
      sliceFn("acceptFormatOfNode"),
      "function typeLabel(t) { return t; }",
      "var ACCEPT_TYPE_FORMAT = {};",
      "function onFieldMoveMouseDown() {}",
      "function onWidthHandleMouseDown() {}",
      // R7 U11a: decorateFieldSelection now calls typeMeta(node.type).choice
      // to decide whether the name tag also arms as a move-handle (choice-
      // bearing groups only). NameFieldsGroup is never a choice type, so a
      // minimal stub (never consulting the real studioMeta) is sufficient —
      // this test's own purpose (non-consuming-type handle rendering) is
      // unaffected by the choice branch, which correctly never fires here.
      "function typeMeta() { return {}; }",
      "function startFieldMove() {}",
      sliceFn("buildHandle"),
      sliceFn("buildInertHandle"),
      sliceFn("decorateFieldSelection"),
    ].join("\n");
    const sandbox: Record<string, unknown> = {
      document: { createTextNode: (t: string) => ({ __text: t }) },
      fakeElFactory: fakeEl,
    };
    runInNewContext(src, sandbox);
    const decorate = sandbox["decorateFieldSelection"] as (el: FakeEl, qid: string, n: unknown) => void;
    decorate(fieldEl, "q_btn", node);
    const wrap = fieldEl.parentNode!;
    const handleLikeEls = wrap.children.filter(
      (c) => c !== fieldEl && c.attrs["data-selection-chrome"] === "1" && (c.getAttribute("style") ?? "").includes("width:11px"),
    );
    expect(handleLikeEls.length, "8 handle-shaped elements render for chrome consistency").toBe(8);
    for (const h of handleLikeEls) {
      expect(h.getAttribute("data-field-resize-handle"), "no resize locator on a non-consuming type").toBeNull();
      expect(h.getAttribute("data-width-handle"), "no legacy width-handle locator either").toBeNull();
      expect(h.listeners, "no mousedown armed — nothing to grab").toEqual([]);
      expect(h.getAttribute("style")).toContain("pointer-events:none");
      expect(h.getAttribute("style")).not.toContain("cursor:");
    }
  });
});

// Fixtures for the pure renderSectionStudio SSR (no D1/KV).
const FIXTURE_VIEW: StudioSectionView = {
  public_id: "lgs_r2_fixture",
  section_name: "R2",
  status: "active",
  activity: "Insurance",
  vertical: "Car",
  headline_text: "What's your ZIP code?",
  subheadline_text: "Rates differ by ZIP",
  continue_mode: "button",
  address_validation_enabled: false,
  content: {
    components: [
      { type: "QuestionHeadline", question_id: "q_h", bind: "section_headline" },
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
      { type: "Spacer", question_id: "q_sp", props: { size: "l" } },
    ],
  },
};
const FIXTURE_SUMMARY: StudioMappingSummary = {
  publishable: true,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 1,
  required_fields_total: 1,
};
const STUDIO_HTML = renderSectionStudio(FIXTURE_VIEW, FIXTURE_SUMMARY, "<span>Active</span>", true, 1, false);

// Cross-check a size override against the REAL server validator.
function heightOverrideErrors(customPx: number): string[] {
  const content = {
    components: [
      { type: "ZIPInputQuestion", question_id: "q", internal_field: "zip", answer_type: "string", design_overrides: { size: { height: { custom_px: customPx } } } } as LeadgenComponentNode,
    ],
  };
  return validateSectionContent(content).errors.filter((e) => e.code === "invalid_size_override").map((e) => e.message);
}

describe("R2 S1-4 — height drag snap/clamp math ([4,600] grid-4, distinct from width)", () => {
  const { snapHeightCustomPx, snapWidthCustomPx } = sizeSandbox();

  it("snaps to the 4px grid and clamps to [4,600]", () => {
    expect(snapHeightCustomPx(56)).toBe(56); // the contract §7.2 worked example
    expect(snapHeightCustomPx(53)).toBe(52); // 13.25 -> round 13 -> 52
    expect(snapHeightCustomPx(2)).toBe(4); // below floor -> clamp to 4 (NOT width's 200)
    expect(snapHeightCustomPx(-10)).toBe(4);
    expect(snapHeightCustomPx(700)).toBe(600); // above ceiling -> clamp
    expect(snapHeightCustomPx(602)).toBe(600);
  });

  it("uses a floor of 4, NOT width's 200 — the axes are genuinely different", () => {
    // The register's whole point: the contract's own 56px height example is
    // BELOW the width floor. A height of 56 stays 56; a WIDTH of 56 clamps to 200.
    expect(snapHeightCustomPx(56)).toBe(56);
    expect(snapWidthCustomPx(56)).toBe(200);
    expect(snapHeightCustomPx(120)).toBe(120);
    expect(snapWidthCustomPx(120)).toBe(200);
  });

  it("every value the height snapper emits is SCHEMA-LEGAL (no drift vs the real validate-time invalid_size_override gate)", () => {
    for (let raw = -50; raw <= 800; raw += 7) {
      const v = snapHeightCustomPx(raw);
      expect(v % 4, `snapped ${raw} -> ${v} must be on the 4px grid`).toBe(0);
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThanOrEqual(600);
      expect(heightOverrideErrors(v), `height custom_px ${v} (from raw ${raw}) must pass the server validator`).toEqual([]);
    }
  });

  it("the validator REJECTS an unsnapped or out-of-range height (proving the gate the snapper satisfies is real)", () => {
    expect(heightOverrideErrors(57).length).toBeGreaterThan(0); // 57 not on the 4px grid
    expect(heightOverrideErrors(700).length).toBeGreaterThan(0); // above 600
    expect(heightOverrideErrors(2).length).toBeGreaterThan(0); // below 4
    expect(heightOverrideErrors(56)).toEqual([]); // snapper output IS accepted
  });
});

describe("R2 S1-3/S1-4 — the resize state machine ships both axes", () => {
  const handler = sliceFn("onWidthHandleMouseDown");
  it("reads a per-handle width side AND height side (the generalized 8-handle machine)", () => {
    expect(handler).toContain("data-fr-wside");
    expect(handler).toContain("data-fr-hside");
  });
  it("writes design_overrides.size.width for a wSide drag and .height for an hSide drag", () => {
    expect(handler).toContain("ref.node.design_overrides.size.width = { custom_px: clamped }");
    expect(handler).toContain("ref.node.design_overrides.size.height = { custom_px: clampedH }");
    expect(handler).toContain("snapHeightCustomPx(rawHeight)");
  });
  it("a corner handle drives BOTH axes in one gesture (wSide and hSide both set) — 4 corner builds", () => {
    const deco = sliceFn("decorateFieldSelection");
    expect(deco).toContain("buildHandle(leftX, topY, 'nwse-resize', 'left', 'top', qid)");
    expect(deco).toContain("buildHandle(rightX, botY, 'nwse-resize', 'right', 'bottom', qid)");
    // and the 4 single-axis edge handles
    expect(deco).toContain("buildHandle(midX, topY, 'ns-resize', '', 'top', qid)");
    expect(deco).toContain("buildHandle(leftX, midY, 'ew-resize', 'left', '', qid)");
  });
});

describe("R2 S1-1/S1-2 — the selection overlay is MEASURED, not hardcoded", () => {
  const deco = sliceFn("decorateFieldSelection");
  it("derives geometry from getBoundingClientRect (both the field and the wrap)", () => {
    expect(deco).toContain("el.getBoundingClientRect");
    expect(deco).toContain("wrap.getBoundingClientRect");
    expect(deco).toContain("fr.left - wr.left");
    expect(deco).toContain("fr.top - wr.top");
  });
  it("no longer ships the golden-demo hardcoded field-outline geometry (66px height / -30 tag / 19/49 rows)", () => {
    expect(deco).not.toContain("height:66px");
    expect(deco).not.toContain("top:-30px");
    // the outline is coincident (measured w/h) with a CSS-outline ring, not a
    // -6px inset border box
    expect(deco).toContain("outline:2px solid #1B3A5C;outline-offset:3px");
  });
  it("all 8 handles are interactive (pointer-events:auto + a resize cursor), fixing S1-3's 6 dead handles", () => {
    const bh = sliceFn("buildHandle");
    expect(bh).toContain("pointer-events:auto");
    expect(bh).toContain("data-field-resize-handle");
    expect(bh).toContain("cursor:");
    // the E/W pair still carries the legacy width-handle locators (synthetic gate)
    expect(bh).toContain("data-width-handle");
    expect(bh).toContain("data-handle-side");
  });
});

describe("R7 U11a — EVERY node moves via the ONE delegated pointer gesture (native DnD retired for canvas moves)", () => {
  it("the bare-input type set is still defined (renderTextInput family) for the size/inline-edit gates that consume it", () => {
    const line = sliceVarLine("var BARE_INPUT_FIELD_TYPES");
    for (const t of ["FreeTextQuestion", "NumberInputQuestion", "EmailInputQuestion", "PhoneInputQuestion", "ZIPInputQuestion", "DateQuestion"]) {
      expect(line).toContain(t);
    }
    expect(line).not.toContain("CurrencyInputQuestion");
    expect(line).not.toContain("AddressAutocompleteQuestion");
  });
  it("the move gesture is DELEGATED on the canvas surface (bindCanvasSurface), not bound per-field", () => {
    const bind = sliceFn("bindCanvasSurface");
    expect(bind, "onFieldMoveMouseDown delegated on the surface").toContain(
      "addEventListener('mousedown', onFieldMoveMouseDown)",
    );
    // the old per-field binding is GONE from decorateFieldSelection.
    const deco = sliceFn("decorateFieldSelection");
    expect(deco).not.toContain("el.addEventListener('mousedown', onFieldMoveMouseDown)");
    expect(deco).toContain("'pointer-events:none'"); // outline still doesn't cover the field
  });
  it("onFieldMoveMouseDown skips selection chrome / choice cards / handles so a drag on a handle still RESIZES", () => {
    const mv = sliceFn("onFieldMoveMouseDown");
    expect(mv).toContain("data-selection-chrome");
    expect(mv).toContain("data-lg-choice");
    expect(mv).toContain("data-question-id");
  });
});

describe("R2 S1-8 — a handle click never changes selection", () => {
  const click = sliceFn("onCanvasClick");
  it("swallows a click that lands on a resize handle before the component-select path", () => {
    expect(click).toContain("closest('[data-field-resize-handle]')");
  });
});

describe("R2 S1-7 / E1-C4 — inline-edit honesty (support check before preventDefault; date excluded)", () => {
  const key = sliceFn("inlineEditKeyFor");
  const dbl = sliceFn("onCanvasDblClick");
  it("placeholder is inline-editable for the text family EXCEPT DateQuestion", () => {
    expect(key).toContain("node.type !== 'DateQuestion'");
    expect(key).toContain("'placeholder'");
  });
  it("preventDefault runs AFTER the support check (unsupported types keep native dblclick)", () => {
    const keyIdx = dbl.indexOf("inlineEditKeyFor(ref.node)");
    const pdIdx = dbl.indexOf("ev.preventDefault()", keyIdx);
    const nullBail = dbl.indexOf("if (key === null) { return; }");
    expect(keyIdx).toBeGreaterThan(-1);
    expect(nullBail).toBeGreaterThan(keyIdx); // the null-bail is checked...
    expect(pdIdx).toBeGreaterThan(nullBail); // ...BEFORE this branch's preventDefault
  });
});

describe("R2 S2-11 — height/corners/border setters re-decorate the canvas (like width)", () => {
  it("setHeightPreset / setNodeCorners / setNodeBorderColor all call applyCanvasDecoration", () => {
    for (const fn of ["setHeightPreset", "setNodeCorners", "setNodeBorderColor"]) {
      expect(sliceFn(fn), `${fn} must re-decorate`).toContain("applyCanvasDecoration()");
    }
  });
  it("a height Custom chip + Reset twin exist and are wired (resetHeightCustom deletes only the height key)", () => {
    expect(STUDIO_HTML).toContain("data-height-custom-chip");
    expect(STUDIO_HTML).toContain("data-reset-height");
    const reset = sliceFn("resetHeightCustom");
    expect(reset).toContain("delete node.design_overrides.size.height");
    expect(reset).not.toContain("size.width");
  });
});

describe("R2 E2-NEW-9 — the Spacer layout controls are no longer EMPTY", () => {
  // R5 D3 (register S4-A3 removal): the canvas toolbar's OWN "layout"
  // cluster/TOOLBAR_LAYOUT_TYPES is DELETED — it was a pure duplicate of the
  // Style tab's renderContainerLayoutPanel (R3b), which already renders the
  // SAME container props over the SAME data-container-prop/data-container-
  // group hooks. This test now asserts the SURVIVING (Style tab) location.
  it("the Style tab's container-layout panel renders a Spacer group with its size control", () => {
    const spacerGroupStart = STUDIO_HTML.indexOf('data-container-group="Spacer"');
    expect(spacerGroupStart, "Spacer container-group present (Style tab)").toBeGreaterThan(-1);
    const spacerGroup = STUDIO_HTML.slice(spacerGroupStart, spacerGroupStart + 400);
    expect(spacerGroup).toContain('data-container-prop="size"');
    expect(spacerGroup).toContain("<select");
    // the toolbar's OWN layout cluster no longer exists at all
    expect(STUDIO_HTML).not.toContain('data-toolbar-cluster="layout"');
  });
});
