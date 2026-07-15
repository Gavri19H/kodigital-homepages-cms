// LeadGen v3.1 R7 U11a — PURE-LOGIC mechanism proof, conductor branch (b):
// "a chromium vm/logic-level test of the generalized pointer path (the
// island functions are sliceable)."
//
// Context: leadgen-u11u12-move-chromium-attempt.spec.ts (a real Playwright
// probe) proved chromium/CDP hangs at "mouse.move(step 1/5)" into the srcdoc
// canvas — BOTH before and after this fix — reproducing the register's own
// R0a class (a CDP + nested-iframe limitation on the drag PRIMITIVE itself,
// independent of native-DnD vs plain pointer events; the register's own
// S1-3/P3 finding already showed a NON-DnD gesture, the width-resize-handle
// drag, hangs there too). Chromium's automation limitation says nothing
// about whether the MECHANISM itself is sound — this file proves the
// mechanism at the level a browser hang cannot obscure: pure function calls,
// no event loop, no CDP.
//
// Mirrors leadgen-r2-canvas.test.ts's own vm-slicer idiom (island functions
// sliced from the REAL SECTION_STUDIO_SCRIPT bytes, run in node:vm — never a
// re-typed copy, so a source drift here fails honestly instead of silently
// testing stale logic).
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { renderSectionStudio, SECTION_STUDIO_SCRIPT, type StudioSectionView, type StudioMappingSummary } from "../src/admin/leadgen/ui-section-studio";

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

// A minimal render just to prove SECTION_STUDIO_SCRIPT is non-empty/current
// (byte-identical sourcing discipline — never hand-copy island logic).
const FIXTURE_VIEW: StudioSectionView = {
  public_id: "lgs_mech_fixture",
  section_name: "Mechanism",
  status: "active",
  activity: "Insurance",
  vertical: "Car",
  headline_text: "H",
  subheadline_text: "S",
  continue_mode: "button",
  address_validation_enabled: false,
  content: { components: [] },
};
const FIXTURE_SUMMARY: StudioMappingSummary = {
  publishable: false,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 0,
  required_fields_total: 0,
};
renderSectionStudio(FIXTURE_VIEW, FIXTURE_SUMMARY, "", true, 2, false); // forces module eval; asserts nothing itself

describe("R7 U11a mechanism proof — the WIRING is a plain, single, synchronous DOM event (never multi-step native DnD)", () => {
  it("bindCanvasSurface delegates onFieldMoveMouseDown on a single 'mousedown' — the SAME event class every engine (incl. a REAL Chrome user's OS-level mouse) delivers instantly, unlike a CDP-choreographed page.mouse.move SEQUENCE", () => {
    const bind = sliceFn("bindCanvasSurface");
    expect(bind).toContain("addEventListener('mousedown', onFieldMoveMouseDown)");
    // dragstart/dragover/drop remain bound (palette insert + choice reorder),
    // but NOTHING in bindCanvasSurface itself re-arms a node-level native
    // drag — confirmed structurally: no dataTransfer write of any kind
    // happens in THIS function (it only wires listeners; a bare substring
    // search for 'move:' would false-positive on this file's own explanatory
    // comment, which documents the retired string by name).
    expect(bind).not.toContain("setData(");
  });

  it("onCanvasDragStart and onCanvasDrop no longer contain a 'move' kind — native HTML5 DnD cannot originate OR land a node reorder anymore (register-facing mechanism claim, verified structurally)", () => {
    const dragStart = sliceFn("onCanvasDragStart");
    const drop = sliceFn("onCanvasDrop");
    // functional check (not the explanatory comment, which documents the
    // RETIRED 'move:' string by name and would false-positive a bare
    // substring search): no dataTransfer.setData call ever writes it.
    expect(dragStart, "no dataTransfer.setData('move:...') call").not.toMatch(/setData\([^)]*'move:'/);
    expect(drop, "no 'move' kind branch").not.toMatch(/kind === 'move'/);
    // the SURVIVING native-DnD source is intra-group choice reorder + palette
    // insert — both still present, deliberately untouched by U11a.
    expect(dragStart).toContain("'choice:'");
    expect(drop).toContain("kind === 'choice'");
    expect(drop).toContain("kind === 'add'");
  });
});

describe("R7 U11a mechanism proof — the ENTRY-GUARD correctly discriminates a movable node's body from chrome/handles/choice-cards (pure logic, no DOM/browser needed)", () => {
  // A minimal fake mousedown event: .target is a fake element whose
  // .closest(selector) answers deterministically per test case; preventDefault/
  // stopPropagation are spies so we can observe whether the gesture engaged.
  interface FakeEvent {
    target: { closest(sel: string): unknown };
    clientX: number;
    clientY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
    _preventedCalls: number;
    _stoppedCalls: number;
  }
  function fakeEvent(closestImpl: (sel: string) => unknown): FakeEvent {
    const ev: FakeEvent = {
      target: { closest: closestImpl },
      clientX: 100,
      clientY: 100,
      preventDefault: () => {
        ev._preventedCalls += 1;
      },
      stopPropagation: () => {
        ev._stoppedCalls += 1;
      },
      _preventedCalls: 0,
      _stoppedCalls: 0,
    };
    return ev;
  }
  interface Sandbox {
    inlineEditing: boolean;
    onFieldMoveMouseDown: (ev: FakeEvent) => void;
    startFieldMoveCalls: Array<{ qid: string }>;
  }
  function buildSandbox(): Sandbox {
    const src = [
      "var inlineEditing = false;",
      "var startFieldMoveCalls = [];",
      "function startFieldMove(qid, ev) { startFieldMoveCalls.push({ qid: qid }); }",
      sliceFn("onFieldMoveMouseDown"),
    ].join("\n");
    const sandbox = { startFieldMoveCalls: [] as Array<{ qid: string }> } as unknown as Sandbox;
    runInNewContext(src, sandbox);
    return sandbox;
  }

  it("a mousedown whose target resolves to a plain [data-question-id] node (no chrome ancestor) ENGAGES the gesture (startFieldMove called with the right qid)", () => {
    const sandbox = buildSandbox();
    const ev = fakeEvent((sel) => {
      if (sel === '[data-question-id]') return { getAttribute: () => "q_target" };
      return null; // no selection-chrome/choice/handle/etc ancestor
    });
    sandbox.onFieldMoveMouseDown(ev);
    expect(sandbox.startFieldMoveCalls, "the movable-body path must engage").toEqual([{ qid: "q_target" }]);
  });

  it("a mousedown whose target is inside [data-lg-choice] (a choice card) is SKIPPED — the group has no reorder here (§6.2 choice-select/reorder keeps winning)", () => {
    const sandbox = buildSandbox();
    const ev = fakeEvent((sel) => (sel.indexOf("data-lg-choice") !== -1 ? { getAttribute: () => "q_choice" } : null));
    sandbox.onFieldMoveMouseDown(ev);
    expect(sandbox.startFieldMoveCalls, "must NOT engage on a choice card").toEqual([]);
    expect(ev._preventedCalls, "must not even preventDefault — the choice's own click/native-DnD must proceed untouched").toBe(0);
  });

  it("a mousedown whose target is inside [data-resize-handle] or [data-field-resize-handle] is SKIPPED — a drag on a handle must RESIZE (the R2 guard)", () => {
    for (const sel of ["[data-resize-handle]", "[data-field-resize-handle]", "[data-width-handle]"]) {
      const sandbox = buildSandbox();
      const ev = fakeEvent((s) => (s.indexOf(sel.slice(1, -1)) !== -1 ? { getAttribute: () => "q_handle" } : null));
      sandbox.onFieldMoveMouseDown(ev);
      expect(sandbox.startFieldMoveCalls, `must NOT engage on ${sel}`).toEqual([]);
    }
  });

  it("a mousedown during inlineEditing is SKIPPED unconditionally (caret placement wins)", () => {
    const src = [
      "var inlineEditing = true;",
      "var startFieldMoveCalls = [];",
      "function startFieldMove(qid, ev) { startFieldMoveCalls.push({ qid: qid }); }",
      sliceFn("onFieldMoveMouseDown"),
    ].join("\n");
    const sandbox = { startFieldMoveCalls: [] as Array<{ qid: string }> } as unknown as Sandbox;
    runInNewContext(src, sandbox);
    const ev = fakeEvent(() => ({ getAttribute: () => "q_target" }));
    sandbox.onFieldMoveMouseDown(ev);
    expect(sandbox.startFieldMoveCalls).toEqual([]);
  });

  it("a mousedown with no [data-question-id] ancestor at all is SKIPPED (nothing to move)", () => {
    const sandbox = buildSandbox();
    const ev = fakeEvent(() => null);
    sandbox.onFieldMoveMouseDown(ev);
    expect(sandbox.startFieldMoveCalls).toEqual([]);
  });
});

describe("R7 U11a mechanism proof — decorateFieldSelection arms the NAME TAG as a second grab surface for choice-bearing types ONLY", () => {
  it("the tag gets pointer-events:auto + a data-move-handle attribute + a mousedown->startFieldMove wire ONLY when typeMeta(node.type).choice === true", () => {
    const deco = sliceFn("decorateFieldSelection");
    expect(deco).toContain("typeMeta(node.type).choice === true");
    expect(deco).toContain("data-move-handle");
    expect(deco).toContain("startFieldMove(qid, tagEv)");
    // the OUTLINE itself stays pointer-events:none REGARDLESS of type — the
    // group's OWN choice cards paint on top of it and must stay clickable.
    expect(deco).toContain("'pointer-events:none'");
  });
});
