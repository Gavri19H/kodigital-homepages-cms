// Section Builder product-core remediation, phase P4d (register PC-8 / PC-A7).
//
// EXECUTED-ISLAND proofs (the leadgen-p4a-studio-behavior.test.ts /
// leadgen-r2-canvas.test.ts vm-probe idiom — sliceFn/sliceVarLine the REAL
// shipped SECTION_STUDIO_SCRIPT bytes into a sandbox, run them against a
// controlled state, assert the ACTUAL computed behavior). PC-8/PC-A7 are
// heavily DOM-coupled (the undo toast + refusal note are real appendChild/
// querySelector calls), so this file supplies the SAME kind of minimal
// fake-DOM harness leadgen-r2-canvas.test.ts's "fake-DOM: applyCanvasDecoration
// on a non-consuming type" test already established for a different function
// — enough surface for showUndoToast/hideUndoToast/showRefusal/clearRefusal
// to run for real, nothing more.
//
// PC-8: deleteSelectedWithUndo used to show "Element deleted" UNCONDITIONALLY
// (findRef null -> label fell back to 'Element', removeNode was a no-op, but
// showUndoToast fired anyway) — a phantom-deletion claim. Fixed: removeNode
// now returns whether it actually removed anything; deleteSelectedWithUndo
// gates the toast on that, and shows an honest refusal note instead of a
// silent no-op when the selection was already stale.
//
// PC-A7: Backspace/Delete on a CHOICE-scoped selection (scopeState==='choice')
// used to delete the WHOLE GROUP (onCanvasKeyDown always called
// deleteSelectedWithUndo(selectedQuestionId) regardless of scope) — the
// operator called this "a disaster". Fixed: the scope check now lives INSIDE
// deleteSelectedWithUndo itself (both the toolbar's plain Delete button and
// the keyboard handler route through the SAME one function, byte-identical
// call sites — see the R4a E3-NEW-7 regression pin this phase keeps green),
// so a choice-scoped delete defers to deleteSelectedChoiceWithUndo, which
// removes ONLY that choice (undo restores it at its original index for
// free — removeChoiceFromNode's own afterModelChange snapshots the FULL
// pre-mutation tree, not a piecewise operation).
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

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

interface FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  className: string;
  hidden: boolean;
  textContent: string;
  children: FakeEl[];
  parentNode: FakeEl | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeEl): FakeEl;
  addEventListener(type: string, cb: () => void): void;
}
function fakeEl(tag: string): FakeEl {
  const el: FakeEl = {
    tagName: tag.toUpperCase(),
    attrs: {},
    className: "",
    hidden: false,
    textContent: "",
    children: [],
    parentNode: null,
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    addEventListener() {
      /* the toast's Undo click is never simulated in these unit probes —
         the LIVE Playwright leg (test-ui) drives the real click + real undo */
    },
  };
  return el;
}

// A minimal fake `document`: a pre-existing [data-studio-drop-refusal] node
// (mirrors the ALWAYS-present SSR'd refusal slot — see renderStudioCanvas),
// a body root, and just enough querySelector/createElement/createTextNode
// for showUndoToast/hideUndoToast/showRefusal/clearRefusal to run unmodified.
function fakeDocument() {
  const refusalEl = fakeEl("p");
  refusalEl.hidden = true;
  refusalEl.attrs["data-studio-drop-refusal"] = "";
  let toastEl: FakeEl | null = null;
  const body = fakeEl("body");
  const doc = {
    querySelector(sel: string): FakeEl | null {
      if (sel === "[data-studio-drop-refusal]") return refusalEl;
      if (sel === "[data-studio-undo-toast]") return toastEl;
      return null;
    },
    getElementById(_id: string): FakeEl | null {
      return null; // forces showUndoToast's documented document.body fallback
    },
    body,
    createElement(tag: string): FakeEl {
      return fakeEl(tag);
    },
    createTextNode(text: string): { textContent: string } {
      return { textContent: text };
    },
  };
  // showUndoToast's toastHost.appendChild(el) call is on document.body here
  // (getElementById returns null) — capture whatever it appends as "the
  // toast", the same way the real DOM would let a test find it afterward.
  const realAppend = body.appendChild.bind(body);
  body.appendChild = (child: FakeEl): FakeEl => {
    if (child.attrs["data-studio-undo-toast"] !== undefined) toastEl = child;
    return realAppend(child);
  };
  return { doc, refusalEl, toastRef: () => toastEl };
}

// One sandbox per test (a shared one would leak selection/history state
// across assertions) — builds the REAL sliced delete/choice/refusal/toast
// machinery + minimal stand-ins for the DOM-rendering neighbors those
// functions call (afterModelChange/selectComponent/renderChoiceEditor/
// setScope) whose OWN behavior these probes are not about.
function buildSandbox(components: unknown[]): {
  sandbox: Record<string, unknown>;
  refusalEl: FakeEl;
  toastRef: () => FakeEl | null;
  run: (expr: string) => unknown;
} {
  const { doc, refusalEl, toastRef } = fakeDocument();
  const src = [
    "function typeMeta(type) { return studioMeta.types[type] || {}; }",
    "function typeLabel(type) { return typeMeta(type).label || type; }",
    sliceFn("isContainerType"),
    sliceFn("findRefIn"),
    sliceFn("findRef"),
    sliceFn("removeNode"),
    sliceFn("findChoice"),
    sliceFn("choiceIndexOf"),
    sliceFn("removeChoiceFromNode"),
    sliceFn("hideUndoToast"),
    sliceFn("showUndoToast"),
    sliceFn("showRefusal"),
    sliceFn("clearRefusal"),
    // Stand-ins: their OWN internals are out of scope for this probe (real
    // DOM re-render / inspector / history-tree bookkeeping) — only the ONE
    // observable effect deleteSelectedWithUndo's own logic depends on
    // (selectedQuestionId / scopeState clearing) is reproduced.
    "function afterModelChange() {}",
    "function selectComponent(qid) { selectedQuestionId = qid || null; }",
    "function renderChoiceEditor() {}",
    "function setScope(scope) { scopeState = scope; }",
    sliceFn("deleteSelectedWithUndo"),
    sliceFn("deleteSelectedChoiceWithUndo"),
  ].join("\n");
  const sandbox: Record<string, unknown> = {
    document: doc,
    setTimeout: () => 0,
    clearTimeout: () => {},
    state: { content: { components } },
    selectedQuestionId: null,
    selectedChoiceValue: null,
    scopeState: "section",
    undoToastTimer: null,
    studioMeta: { types: { TwoButtonYesNo: { label: "Yes / No" }, ButtonAnswerGroup: { label: "Answer buttons" } } },
  };
  runInNewContext(src, sandbox);
  return {
    sandbox,
    refusalEl,
    toastRef,
    run: (expr: string) => runInNewContext(expr, sandbox),
  };
}

describe("PC-8 — removeNode reports whether it actually removed anything", () => {
  it("returns true and splices the node out when the qid exists", () => {
    const { sandbox, run } = buildSandbox([{ type: "TwoButtonYesNo", question_id: "q1" }]);
    sandbox.selectedQuestionId = "q1";
    expect(run("removeNode('q1')")).toBe(true);
    expect((sandbox.state as { content: { components: unknown[] } }).content.components).toEqual([]);
    expect(sandbox.selectedQuestionId).toBeNull();
  });
  it("returns false and leaves the tree untouched when the qid does not exist", () => {
    const { sandbox, run } = buildSandbox([{ type: "TwoButtonYesNo", question_id: "q1" }]);
    expect(run("removeNode('ghost')")).toBe(false);
    expect((sandbox.state as { content: { components: unknown[] } }).content.components).toEqual([
      { type: "TwoButtonYesNo", question_id: "q1" },
    ]);
  });
});

describe("PC-8 — deleteSelectedWithUndo never shows a phantom toast for a stale/absent selection", () => {
  it("a REAL selection: removes the node, clears selection, shows the undo toast with the type label", () => {
    const { sandbox, refusalEl, toastRef, run } = buildSandbox([{ type: "TwoButtonYesNo", question_id: "q1" }]);
    sandbox.selectedQuestionId = "q1";
    run("deleteSelectedWithUndo('q1')");
    expect((sandbox.state as { content: { components: unknown[] } }).content.components).toEqual([]);
    expect(sandbox.selectedQuestionId).toBeNull();
    expect(toastRef(), "the undo toast was appended").not.toBeNull();
    expect(toastRef()!.attrs["data-studio-undo-toast"]).toBe("");
    const toastText = toastRef()!.children.map((c) => (c as unknown as { textContent?: string }).textContent ?? "").join("");
    expect(toastText, "names the REAL type label, not the 'Element' fallback").toContain("Yes / No deleted");
    expect(refusalEl.hidden, "no refusal note for a real deletion").toBe(true);
  });
  it("a STALE qid (already gone / never existed): NO toast, the selection is cleared, an honest refusal note shows — never a phantom 'deleted' claim", () => {
    const { sandbox, refusalEl, toastRef, run } = buildSandbox([{ type: "TwoButtonYesNo", question_id: "q1" }]);
    sandbox.selectedQuestionId = "ghost"; // desynced: nothing in the tree has this id
    run("deleteSelectedWithUndo('ghost')");
    // the real q1 node must survive untouched — a stale-id delete call must
    // never accidentally remove an unrelated node
    expect((sandbox.state as { content: { components: unknown[] } }).content.components).toEqual([
      { type: "TwoButtonYesNo", question_id: "q1" },
    ]);
    expect(sandbox.selectedQuestionId, "the dead id is cleared, never left armed").toBeNull();
    expect(toastRef(), "no phantom undo toast").toBeNull();
    expect(refusalEl.hidden, "the honest refusal note is shown").toBe(false);
    expect(refusalEl.textContent).toContain("Nothing to delete");
  });
});

describe("PC-A7 — a CHOICE-scoped Backspace/Delete removes ONLY the choice, never the group", () => {
  it("scopeState 'choice' + a real choice value: the group survives, only that ONE choice is gone, the toast names the choice (not the group's type)", () => {
    const group = {
      type: "ButtonAnswerGroup",
      question_id: "qg",
      choices: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    };
    const { sandbox, refusalEl, toastRef, run } = buildSandbox([group]);
    sandbox.selectedQuestionId = "qg";
    sandbox.scopeState = "choice";
    sandbox.selectedChoiceValue = "no";
    // the SAME call site the keyboard handler and the toolbar's plain
    // Delete button both use — deleteSelectedWithUndo itself routes by scope
    run("deleteSelectedWithUndo('qg')");
    const components = (sandbox.state as { content: { components: Array<{ question_id: string; choices: Array<{ value: string }> }> } })
      .content.components;
    expect(components.length, "the GROUP itself is never removed").toBe(1);
    expect(components[0]!.question_id).toBe("qg");
    expect(components[0]!.choices.map((c) => c.value)).toEqual(["yes"]);
    expect(sandbox.selectedQuestionId, "the group stays selected — only the choice scope ends").toBe("qg");
    expect(sandbox.scopeState, "scope falls back to component, not cleared to section").toBe("component");
    expect(toastRef(), "an undo toast still confirms the choice delete").not.toBeNull();
    const toastText = toastRef()!.children.map((c) => (c as unknown as { textContent?: string }).textContent ?? "").join("");
    expect(toastText, "names the CHOICE's own label ('No'), not the group's type").toContain("No deleted");
    expect(refusalEl.hidden).toBe(true);
  });
  it("scopeState 'component' (the SAME qid, no choice focused): the whole group is deleted — unchanged pre-existing behavior", () => {
    const group = { type: "ButtonAnswerGroup", question_id: "qg", choices: [{ label: "Yes", value: "yes" }] };
    const { sandbox, run } = buildSandbox([group]);
    sandbox.selectedQuestionId = "qg";
    sandbox.scopeState = "component";
    sandbox.selectedChoiceValue = null;
    run("deleteSelectedWithUndo('qg')");
    expect((sandbox.state as { content: { components: unknown[] } }).content.components).toEqual([]);
    expect(sandbox.selectedQuestionId).toBeNull();
  });
  it("undo (a full content-tree snapshot revert, the pre-existing history mechanism) restores the choice at its ORIGINAL index — proven at the removeChoiceFromNode layer directly: splice-out then splice-back-in reproduces the exact array a real historyUndo would restore", () => {
    // deleteSelectedChoiceWithUndo does not invent its own persistence — it
    // reuses removeChoiceFromNode's existing afterModelChange/historyPush
    // hook (a snapshot of the tree BEFORE the splice). This asserts the
    // half of that contract this file can exercise without the full
    // historyPush/historyUndo stack (covered live in test-ui): the removal
    // is a plain array splice at a known index, so reinserting at that same
    // index (exactly what a full-snapshot revert produces) reproduces the
    // original order byte-for-byte.
    const group = {
      type: "ButtonAnswerGroup",
      question_id: "qg",
      choices: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
        { label: "C", value: "c" },
      ],
    };
    const original = JSON.parse(JSON.stringify(group.choices));
    const { sandbox, run } = buildSandbox([group]);
    sandbox.selectedQuestionId = "qg";
    sandbox.scopeState = "choice";
    sandbox.selectedChoiceValue = "b";
    run("deleteSelectedWithUndo('qg')");
    const afterDelete = (sandbox.state as { content: { components: Array<{ choices: unknown[] }> } }).content.components[0]!.choices;
    expect(afterDelete.map((c) => (c as { value: string }).value)).toEqual(["a", "c"]);
    afterDelete.splice(1, 0, original[1]); // the undo-restore a full snapshot revert performs
    expect(afterDelete).toEqual(original);
  });
  it("a STALE choice value (already gone): NO toast, an honest refusal — the same PC-8 honesty extended to choice deletes", () => {
    const group = { type: "ButtonAnswerGroup", question_id: "qg", choices: [{ label: "Yes", value: "yes" }] };
    const { sandbox, refusalEl, toastRef, run } = buildSandbox([group]);
    sandbox.selectedQuestionId = "qg";
    sandbox.scopeState = "choice";
    sandbox.selectedChoiceValue = "ghost-value";
    run("deleteSelectedWithUndo('qg')");
    const components = (sandbox.state as { content: { components: Array<{ choices: unknown[] }> } }).content.components;
    expect(components[0]!.choices, "the real choice survives untouched").toEqual([{ label: "Yes", value: "yes" }]);
    expect(toastRef()).toBeNull();
    expect(refusalEl.hidden).toBe(false);
  });
});
