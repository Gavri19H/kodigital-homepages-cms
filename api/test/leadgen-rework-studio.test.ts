// LeadGen Rework — Phase P2 slice S2.4 (Studio island: §6 inspector panels +
// §6.1 placement + §4.1 starter + §10 removals). jsdom-lockstep proofs over the
// REAL exported render functions + the REAL served island text (L-196: assert
// the RENDERED inspector output, never the source; the phone-mask lockstep runs
// the ACTUAL island parser). The full §6.2 capability MATRIX test is S2.5's
// (leadgen-rework-matrix.test.ts); here we prove the MECHANISM (studioTypeMeta
// projects COMPONENT_CAPABILITIES) + the panels + the removals.
//
// The interactive DOM flows (starter insertion, field-set drag/CRUD, other-value
// clearing) are exercised live BOTH ENGINES by the Playwright studio specs
// (gate ritual step 4). Here we run the ONE pure island primitive that has a
// contract-pinned lockstep — parsePhoneMask (the ES5 twin of
// content-schema.parsePhoneMaskPattern) — and assert byte-identical scaffolds,
// plus source-level wiring proofs for the exact seeded labels/fields.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  renderStudioInspector,
  renderStudioLibrary,
  studioTypeMeta,
  STUDIO_LIBRARY_GROUPS,
} from "../src/admin/leadgen/ui-section-studio";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import {
  parsePhoneMaskPattern,
  LEADGEN_PHONE_MASK_ERROR,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

// --- fixtures ---------------------------------------------------------------

const DESIGN = getFunnelDesign(null);
const EMPTY_CONTENT = { components: [] } as unknown as LeadgenSectionContent;
// renderStudioInspector emits every inspector block ONCE server-side (the island
// then shows/hides per selection) — so this single markup carries every panel.
const INSPECTOR = renderStudioInspector(DESIGN, "sec_test");
const LIBRARY = renderStudioLibrary(DESIGN, EMPTY_CONTENT);
// The island is literal ES5 TEXT inside the .ts (a template literal) — this IS
// the served island source, so slicing a pure function from it and running it is
// running the SAME code the browser runs (L-189: assert effect with real input).
const STUDIO_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/admin/leadgen/ui-section-studio.ts"),
  "utf8",
);

// Brace-matched slice of `function NAME(...) { ... }` from the island source
// (the repo's leadgen-section-studio-ui.test.ts idiom).
function sliceIslandFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = STUDIO_SRC.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = STUDIO_SRC.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < STUDIO_SRC.length; i += 1) {
    if (STUDIO_SRC[i] === "{") depth += 1;
    else if (STUDIO_SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return STUDIO_SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}
// A single-statement `var NAME = <expr>;` (object literal on one line, no nested ;).
function sliceIslandLine(startsWith: string): string {
  const start = STUDIO_SRC.indexOf(startsWith);
  expect(start, `island line "${startsWith}"`).toBeGreaterThan(-1);
  const end = STUDIO_SRC.indexOf(";", start);
  return STUDIO_SRC.slice(start, end + 1);
}

// Compile the island's parsePhoneMask (+ its PHONE_MASK_LITERALS table) in a vm.
function islandParsePhoneMask(): (p: unknown) => { groups: number[]; scaffold: string; digit_count: number } | null {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(
    sliceIslandLine("var PHONE_MASK_LITERALS =") +
      "\n" +
      sliceIslandFunction("parsePhoneMask") +
      "\nthis.__parsePhoneMask = parsePhoneMask;",
    sandbox,
  );
  return sandbox["__parsePhoneMask"] as (p: unknown) => { groups: number[]; scaffold: string; digit_count: number } | null;
}

// =============================================================================
// §6.9 / M8 — phone mask builder + the parsePhoneMask lockstep
// =============================================================================

describe("§6.9/M8 phone mask builder", () => {
  it("the island parsePhoneMask twin produces BYTE-IDENTICAL scaffolds to content-schema.parsePhoneMaskPattern (chip patterns + 6 more, valid + invalid)", () => {
    const island = islandParsePhoneMask();
    const cases = [
      "(3) 3-4", // US chip → (___) ___-____, 10
      "3-4", // 7-digit chip → ___-____, 7
      "(3)3-4",
      "3.3.4",
      "10-5",
      "2 3 4 4",
      "4",
      "1-1-1-1", // total 4 (min ok)
      // invalid — both must return null identically:
      "(3x) 3-4",
      "",
      "0-5",
      "21",
      "3-3-3-3-3-3-3",
      "1-1",
    ];
    for (const p of cases) {
      const ts = parsePhoneMaskPattern(p);
      const es5 = island(p);
      if (ts === null) {
        expect(es5, `island parse of ${JSON.stringify(p)} matches null`).toBeNull();
      } else {
        expect(es5, `island parse of ${JSON.stringify(p)} not null`).not.toBeNull();
        expect(es5!.scaffold, `scaffold lockstep for ${JSON.stringify(p)}`).toBe(ts.scaffold);
        expect(es5!.digit_count, `digit_count lockstep for ${JSON.stringify(p)}`).toBe(ts.digit_count);
        expect(es5!.groups, `groups lockstep for ${JSON.stringify(p)}`).toEqual(ts.groups);
      }
    }
    // the specific chip scaffolds the pack pins.
    expect(island("(3) 3-4")!.scaffold).toBe("(___) ___-____");
    expect(island("3-4")!.scaffold).toBe("___-____");
  });

  it("the inspector renders the mask builder (Format input, live preview, prefill chips, message) and the A-10 error copy is the schema constant VERBATIM", () => {
    expect(INSPECTOR).toContain("data-phone-mask-pattern");
    expect(INSPECTOR).toContain("data-phone-mask-preview");
    expect(INSPECTOR).toContain('data-phone-mask-chip="(3) 3-4"');
    expect(INSPECTOR).toContain('data-phone-mask-chip="3-4"');
    expect(INSPECTOR).toContain("data-phone-mask-message");
    expect(INSPECTOR).toContain("US (3) 3-4");
    expect(INSPECTOR).toContain("7-digit 3-4");
    // A-7 default incomplete message rides the message input placeholder.
    expect(INSPECTOR).toContain("Enter a complete phone number.");
    // A-10 verbatim lives in the island error state (single grammar source).
    expect(STUDIO_SRC).toContain(LEADGEN_PHONE_MASK_ERROR);
    expect(LEADGEN_PHONE_MASK_ERROR).toBe("Format must be digit groups with separators, like (3) 3-4.");
  });

  it("the removed phone country-preset trio + raw-regex custom path are absent from the rendered inspector (L-196)", () => {
    expect(INSPECTOR).not.toContain("data-phone-format-preset");
    expect(INSPECTOR).not.toContain("data-phone-format-field");
    expect(INSPECTOR).not.toContain("US (default)");
    expect(INSPECTOR).not.toContain("International (+ country code)");
    expect(INSPECTOR).not.toContain(">Israel<");
    expect(INSPECTOR).not.toContain("Custom pattern");
  });
});

// =============================================================================
// §6.2 — the capability MATRIX feeds the studio (mechanism, 5 representative types)
// =============================================================================

describe("§6.2 spec-driven control matrix (studioTypeMeta projects COMPONENT_CAPABILITIES)", () => {
  const meta = studioTypeMeta();
  it("projects capabilities for every catalog type", () => {
    expect(meta["ButtonAnswerGroup"]!.capabilities).toBeTruthy();
    expect(meta["PhoneInputQuestion"]!.capabilities).toBeTruthy();
  });
  it("Buttons: label+helper, choices editor, Other editor, default 'choice', selected-marker", () => {
    const c = meta["ButtonAnswerGroup"]!.capabilities;
    expect(c.label_helper).toBe(true);
    expect(c.choices_editor).toBe(true);
    expect(c.other_editor).toBe(true);
    expect(c.default_kind).toBe("choice");
    expect(c.selected_marker).toBe(true);
    expect(c.mask_builder).toBe(false);
    expect(c.slider_type).toBe(false);
    expect(c.field_set_maps).toBe(false);
  });
  it("Yes/No: labels-only choices, default 'yesno', selected-marker, NO Other editor", () => {
    const c = meta["TwoButtonYesNo"]!.capabilities;
    expect(c.choices_editor).toBe("labels_only");
    expect(c.default_kind).toBe("yesno");
    expect(c.selected_marker).toBe(true);
    expect(c.other_editor).toBe(false);
  });
  it("Dropdown: NO Other editor and NO selected-marker (the #10 fix)", () => {
    const c = meta["DropdownQuestion"]!.capabilities;
    expect(c.other_editor).toBe(false);
    expect(c.selected_marker).toBe(false);
    expect(c.default_kind).toBe("dropdown");
  });
  it("Phone: mask builder; Slider: slider type; Address: field set + maps", () => {
    expect(meta["PhoneInputQuestion"]!.capabilities.mask_builder).toBe(true);
    expect(meta["NumberRangeQuestion"]!.capabilities.slider_type).toBe(true);
    expect(meta["AddressAutocompleteQuestion"]!.capabilities.field_set_maps).toBe(true);
    // MultiChoice has no default in v1.
    expect(meta["MultiChoiceCardGroup"]!.capabilities.default_kind).toBeNull();
  });
});

// =============================================================================
// §6.3 label+helper · §6.4 choice default · §6.6 selected-marker
// =============================================================================

describe("§6.3/§6.4/§6.6 inspector controls", () => {
  it("§6.3: the Basics label is 'Question label' and the stale 'only you see this' caption is GONE", () => {
    expect(INSPECTOR).toContain("Question label");
    expect(INSPECTOR).not.toContain("only you see this");
  });
  it("§6.4: a 'choice' default control exists (select over the node's choices → props.defaultValue)", () => {
    expect(INSPECTOR).toContain('data-default-wrap="choice"');
    expect(INSPECTOR).toContain('data-default-control="choice"');
    // defaultKindOf is matrix-driven and the choice branch writes props.defaultValue.
    expect(STUDIO_SRC).toContain("props.defaultValue = v;");
  });
  it("§6.6: the per-node selected-marker segmented (Inherit/Wash/Mark → props.selected_marker)", () => {
    expect(INSPECTOR).toContain("data-selected-marker-wrap");
    expect(INSPECTOR).toContain('data-set-selected-marker="wash"');
    expect(INSPECTOR).toContain('data-set-selected-marker="mark"');
    expect(INSPECTOR).toContain('data-set-selected-marker=""'); // Inherit
  });
});

// =============================================================================
// §6.5 — authored "Other" values editor (replaces choiceDisplay/mainValues)
// =============================================================================

describe("§6.5 authored Other editor", () => {
  it("renders the enable toggle + Other label + values list (base-choice anatomy) + Add value", () => {
    expect(INSPECTOR).toContain("data-other-editor-block");
    expect(INSPECTOR).toContain("data-other-enabled");
    expect(INSPECTOR).toContain("data-other-label");
    expect(INSPECTOR).toContain("data-other-values");
    expect(INSPECTOR).toContain("data-other-add");
    expect(INSPECTOR).toContain("Other values");
  });
  it("the choiceDisplay/mainValues re-bucketing UI is removed from the rendered inspector (L-196)", () => {
    expect(INSPECTOR).not.toContain("data-choicedisplay=");
    expect(INSPECTOR).not.toContain('Enable &quot;Other&quot; group');
    expect(INSPECTOR).not.toContain("Searchable Other panel");
    expect(INSPECTOR).not.toContain('data-choice-main');
  });
  it("collectOther writes props.other = {enabled, label?, choices} (schema shape) and each other value defaults analytics_id to its value", () => {
    const src = sliceIslandFunction("collectOther");
    expect(src).toContain("props.other = otherOut");
    expect(src).toContain("otherOut.choices = choices");
    expect(src).toContain("choice.analytics_id = choice.value");
  });
});

// =============================================================================
// §6.8 — slider type picker (replaces the Format-$ type-flip)
// =============================================================================

describe("§6.8 slider type picker", () => {
  it("renders all five slider-type thumbnails + the display-only currency-affix toggle", () => {
    for (const t of ["single", "dual_range", "stepper", "from_to", "radial"]) {
      expect(INSPECTOR).toContain(`data-set-slider-type="${t}"`);
    }
    expect(INSPECTOR).toContain("data-slider-type-wrap");
    expect(INSPECTOR).toContain("data-slider-currency-affix");
    expect(INSPECTOR).toContain("Currency symbol ($) prefix");
  });
  it("the Format-$ type-flip toggle (toggleSliderFormat, the Image9 failure class) is removed", () => {
    expect(INSPECTOR).not.toContain("data-toolbar-slider-format");
    expect(INSPECTOR).not.toContain("Format $:");
    expect(STUDIO_SRC).not.toContain("function toggleSliderFormat");
    // currency affix never mutates node.type/answer_type.
    const src = sliceIslandFunction("setCurrencyAffix");
    expect(src).toContain("props.currency_affix = true");
    expect(src).not.toContain("node.type =");
  });
});

// =============================================================================
// §6.10 — address field-set editor (replaces the fixed composite + type-lock)
// =============================================================================

describe("§6.10/M9 address field-set editor", () => {
  it("renders the field-set editor (rows host, Add field, Plain text address preset)", () => {
    expect(INSPECTOR).toContain("data-address-fieldset-block");
    expect(INSPECTOR).toContain("data-address-rows");
    expect(INSPECTOR).toContain("data-address-add");
    expect(INSPECTOR).toContain("data-address-preset-plain");
    expect(INSPECTOR).toContain("Plain text address");
    expect(INSPECTOR).toContain("+ Add field");
  });
  it("the address type-lock note is removed (L-196)", () => {
    expect(INSPECTOR).not.toContain("data-accept-address-lock");
    expect(INSPECTOR).not.toContain("Address is a fixed type");
  });
  it("collectAddressFields writes props.fields[] as {field, mode, label?, validation?, required?}; the Plain preset seeds a lone full_address", () => {
    const collect = sliceIslandFunction("collectAddressFields");
    expect(collect).toContain("props.fields = fields");
    expect(collect).toContain("f.validation = 'zip5'");
    const preset = sliceIslandFunction("applyAddressPresetPlain");
    expect(preset).toContain("field: 'full_address'");
    // the add-menu offers full_address as the only-alone kind (replaces the set).
    const addField = sliceIslandFunction("addAddressField");
    expect(addField).toContain("clearChildren(listEl)");
  });
});

// =============================================================================
// §4.1 — "Questions on one screen" palette starter (replaces the grid tile)
// =============================================================================

describe("§4.1 palette starter", () => {
  const allTiles = STUDIO_LIBRARY_GROUPS.flatMap((g) => g.tiles);
  it("the 'Questions on one screen' starter tile exists (TwoButtonYesNo, starter marker) and the 'Question grid' tile is gone", () => {
    const starter = allTiles.find((t) => t.label === "Questions on one screen");
    expect(starter, "starter tile present").toBeTruthy();
    expect(starter!.defaultType).toBe("TwoButtonYesNo");
    expect(starter!.starter).toBe("questions_one_screen");
    // §10: the grid catalog type is removed, so `defaultType` (a ComponentType)
    // can never be it — String() to compare against the extinct id.
    expect(allTiles.some((t) => String(t.defaultType) === "MultiQuestionGrid")).toBe(false);
    expect(allTiles.some((t) => t.label === "Question grid")).toBe(false);
    // the tile renders the starter marker so click/keyboard/drag resolve to it.
    expect(LIBRARY).toContain('data-add-starter="questions_one_screen"');
  });
  it("insertQuestionsOnOneScreen seeds exactly 2 TwoButtonYesNo with labels/fields Question 1/answer1 + Question 2/answer2", () => {
    const src = sliceIslandFunction("insertQuestionsOnOneScreen");
    expect(src).toContain("makeStarterYesNo('Question 1', 'answer1')");
    expect(src).toContain("makeStarterYesNo('Question 2', 'answer2')");
    expect(src).toContain("target.splice(at, 0, q1, q2)");
    const seed = sliceIslandFunction("makeStarterYesNo");
    expect(seed).toContain("makeNode('TwoButtonYesNo')");
    expect(seed).toContain("node.internal_field = field");
    expect(seed).toContain("node.props.label = labelText");
  });
});

// =============================================================================
// §6.1 — add-ghost placement (sibling AFTER the component root; live == edit)
// =============================================================================

describe("§6.1 add-ghost placement", () => {
  it("the '+ Add choice' ghost is inserted as a SIBLING after the component root (never a child/grid cell)", () => {
    const src = sliceIslandFunction("decorateChoiceCards");
    // sibling insert after the root, not nodes[i].appendChild(ghost).
    expect(src).toContain("insertBefore(ghostRow, nodes[i].nextSibling)");
    expect(src).toContain("studio-add-ghost-btn");
    // the grid ("+ Add a sub-question") canvas affordance is gone.
    expect(src).not.toContain("data-mqg-add-canvas");
  });
  it("the ghost row CSS lives in the canvas-frame stylesheet (the srcdoc the ghost renders into)", () => {
    expect(STUDIO_SRC).toContain(".studio-add-ghost-row");
    expect(STUDIO_SRC).toContain(".studio-add-ghost-btn");
  });
});

// =============================================================================
// §10 removals — Sub-questions block absent from the rendered inspector
// =============================================================================

describe("§10 studio removals (rendered inspector)", () => {
  it("the MultiQuestionGrid Sub-questions (rows) editor block is gone", () => {
    expect(INSPECTOR).not.toContain("data-mqg-rows-block");
    expect(INSPECTOR).not.toContain("+ Add sub-question");
  });
});

// =============================================================================
// §6.1 add-ghost — re-render idempotence (the S2.5 accumulation bug)
// =============================================================================
// A minimal mini-DOM (env is "node", no jsdom) runs the REAL decorate flow —
// the stale-cleanup selector (extracted from source, so this tracks the fix)
// then decorateChoiceCards — 3 consecutive times, proving EXACTLY 1 ghost
// survives. Fail-before: the stale selector omitted the renamed
// .studio-add-ghost-row, so each re-render stacked another ghost (S2.5 measured
// 2-3). Pass-after: the selector now clears it, so re-renders stay idempotent.

class MiniEl {
  tagName: string;
  className = "";
  _attrs: Record<string, string> = {};
  childNodes: MiniEl[] = [];
  parentNode: MiniEl | null = null;
  nodeType = 1;
  textContent = "";
  style: Record<string, string> = {};
  constructor(tag: string) {
    this.tagName = String(tag).toUpperCase();
  }
  setAttribute(k: string, v: string): void {
    this._attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return k === "class" ? this.className : this._attrs[k] ?? null;
  }
  appendChild(c: MiniEl): MiniEl {
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  insertBefore(c: MiniEl, ref: MiniEl | null): MiniEl {
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i === -1) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild(c: MiniEl): MiniEl {
    const i = this.childNodes.indexOf(c);
    if (i !== -1) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  get firstChild(): MiniEl | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): MiniEl | null {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.childNodes.indexOf(this);
    return i >= 0 && i + 1 < p.childNodes.length ? p.childNodes[i + 1]! : null;
  }
  descendants(): MiniEl[] {
    const out: MiniEl[] = [];
    for (const c of this.childNodes) {
      out.push(c);
      out.push(...c.descendants());
    }
    return out;
  }
  matches(sel: string): boolean {
    const s = sel.trim();
    if (s[0] === ".") return (" " + this.className + " ").indexOf(" " + s.slice(1) + " ") !== -1;
    if (s[0] === "[" && s[s.length - 1] === "]") {
      const inner = s.slice(1, -1);
      const eq = inner.indexOf("=");
      if (eq === -1) return this._attrs[inner] !== undefined;
      const key = inner.slice(0, eq);
      const val = inner.slice(eq + 1).replace(/^["']|["']$/g, "");
      return this.getAttribute(key) === val;
    }
    return false;
  }
  querySelectorAll(sel: string): MiniEl[] {
    const parts = String(sel).split(",").map((p) => p.trim());
    return this.descendants().filter((d) => parts.some((p) => d.matches(p)));
  }
  closest(sel: string): MiniEl | null {
    let n: MiniEl | null = this;
    while (n) {
      if (n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
}
function makeEl(tag: string): MiniEl {
  return new MiniEl(tag);
}
function makeText(t: string): MiniEl {
  const n = new MiniEl("#text");
  n.nodeType = 3;
  n.textContent = t;
  return n;
}

describe("§6.1 add-ghost re-render idempotence", () => {
  it("3 consecutive re-renders leave EXACTLY 1 '+ Add choice' ghost (the renamed .studio-add-ghost-row is in the stale-cleanup set)", () => {
    // extract the ACTUAL stale-cleanup selector from source (so this test tracks
    // the real fix, not a copy).
    const staleMarker = "var stale = region.querySelectorAll('";
    const s = STUDIO_SRC.indexOf(staleMarker);
    expect(s, "stale-cleanup selector present").toBeGreaterThan(-1);
    const from = s + staleMarker.length;
    const STALE_SELECTOR = STUDIO_SRC.slice(from, STUDIO_SRC.indexOf("'", from));
    expect(STALE_SELECTOR, "the renamed ghost row is in the cleanup set").toContain(".studio-add-ghost-row");

    const documentStub = {
      createElement: (t: string) => makeEl(t),
      createTextNode: (t: string) => makeText(t),
    };
    const sandbox: Record<string, unknown> = {
      document: documentStub,
      studioMeta: { max_depth: 4, types: studioTypeMeta() },
      selectedQuestionId: null,
      selectedChoiceValue: null,
    };
    runInNewContext(
      [
        "function canvasFrameDoc() { return null; }",
        sliceIslandFunction("frameCreate"),
        sliceIslandFunction("typeMeta"),
        sliceIslandFunction("decorateChoiceCards"),
        "this.__decorate = decorateChoiceCards;",
      ].join("\n"),
      sandbox,
    );
    const decorate = sandbox["__decorate"] as (r: MiniEl) => void;

    // region with ONE ButtonAnswerGroup component node (a choice-bearing type).
    const region = makeEl("div");
    const node = makeEl("div");
    node.setAttribute("data-question-id", "q1");
    node.setAttribute("data-component-type", "ButtonAnswerGroup");
    region.appendChild(node);

    const ghostCount = () => region.querySelectorAll("[data-choice-ghost]").length;
    for (let r = 0; r < 3; r++) {
      // the studio's re-render: stale-cleanup THEN decorate.
      for (const stale of region.querySelectorAll(STALE_SELECTOR)) {
        if (stale.parentNode) stale.parentNode.removeChild(stale);
      }
      decorate(region);
      expect(ghostCount(), `exactly 1 ghost after re-render ${r + 1}`).toBe(1);
    }
    // and the ghost is a SIBLING of the component root, never a child of it.
    expect(node.querySelectorAll("[data-choice-ghost]").length, "ghost is NOT inside the component box").toBe(0);
    expect(region.querySelectorAll("[data-add-ghost-row]").length, "one ghost row at region level").toBe(1);
  });
});
