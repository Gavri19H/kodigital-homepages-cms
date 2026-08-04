// P8 SLICE S5.2c — the humanizer that invents field names, and the studio's
// rough edges (contract §6 M5 / §7 N16). Owner, verbatim: "the rules you
// build are using jargon".
//
// Every function under test is SLICED from the REAL exported
// SECTION_STUDIO_SCRIPT (the byte-identical source the browser receives) and
// run for real in a vm sandbox — never re-implemented. Only DOM/data
// COLLABORATORS are stubbed; the code under test is the real, shipped code.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

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

function sliceIslandVar(script: string, name: string): string {
  const marker = `var ${name} = {`;
  const start = script.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return `${script.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced braces while slicing island var ${name}`);
}

// A tiny recording DOM-element stub (the SAME shape leadgen-section-studio-ui
// test's own StubEl uses for this exact area — box/li/button/text nodes).
interface StubEl {
  tag: string;
  textContent: string;
  attrs: Record<string, string>;
  children: StubEl[];
  hidden: boolean;
  listeners: Record<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(c: StubEl): StubEl;
  addEventListener(k: string, f: () => void): void;
  allText(): string;
}
function stubEl(tag: string, text = ""): StubEl {
  const el: StubEl = {
    tag,
    textContent: text,
    attrs: {},
    children: [],
    hidden: false,
    listeners: {},
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k]! : null;
    },
    appendChild(c) {
      el.children.push(c);
      return c;
    },
    addEventListener(k, f) {
      (el.listeners[k] = el.listeners[k] ?? []).push(f);
    },
    allText() {
      return el.textContent + el.children.map((c) => c.allText()).join("");
    },
  };
  return el;
}

describe("P8 S5.2c — renderSaveFieldErrors no longer invents/mangles a field name (contract §6 M5)", () => {
  function buildSandbox(components: unknown[]) {
    const box = stubEl("div");
    const focused: string[] = [];
    const sandbox: Record<string, unknown> = {
      state: { content: { components } },
      selectComponent(qid: string) {
        focused.push(qid);
      },
      focused,
      document: {
        querySelector(sel: string) {
          return sel === "[data-studio-save-problems]" ? box : null;
        },
        createElement(tag: string) {
          return stubEl(tag);
        },
        createTextNode(text: string) {
          return stubEl("#text", text);
        },
      },
    };
    const src = [
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "clearChildren"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "componentByProblemPath"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "saveProblemFocusHandler"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "renderSaveFieldErrors"),
    ].join("\n");
    runInNewContext(src, sandbox);
    return { sandbox, box };
  }

  it("the real duplicate-internal-field message keeps the operator's OWN lowercase value verbatim ('ks_nm' — never 'Ks Nm')", () => {
    // The exact wire text captured LIVE via curl POST against the running
    // dev instance for a duplicated internal_field named "ks_nm" (the
    // contract's own worked example):
    //   {"error":"Validation failed","fields":{"content.components[1].internal_field":
    //    "Another question in this Section already uses the Internal field
    //    'ks_nm' — each question needs its own. Rename one of them."}}
    const REAL_MESSAGE =
      "Another question in this Section already uses the Internal field 'ks_nm' — each question needs its own. Rename one of them.";
    const { sandbox, box } = buildSandbox([
      { type: "FreeTextQuestion", question_id: "q1", internal_field: "ks_nm", props: { label: "A" } },
      { type: "FreeTextQuestion", question_id: "q2", internal_field: "ks_nm", props: { label: "B" } },
    ]);
    runInNewContext(
      "renderSaveFieldErrors([{ path: 'content.components[1].internal_field', message: " +
        JSON.stringify(REAL_MESSAGE) +
        " }])",
      sandbox,
    );
    const rendered = box.allText();
    expect(rendered, "the real value must survive un-mangled").toContain("'ks_nm'");
    expect(rendered, "the old humanizer's Title-Case corruption must be gone").not.toContain("Ks Nm");
    // Row identity: the row now names the specific component it is about
    // (its own authored label "B") rather than only the last path segment.
    expect(rendered).toContain("B: ");
  });

  it("two DIFFERENT components sharing the identical generic sentence now read as two different rows", () => {
    const GENERIC = "The Free text needs an 'Internal field' — the name its answer is saved under. Enter one.";
    const { sandbox, box } = buildSandbox([
      { type: "FreeTextQuestion", question_id: "q1", props: { label: "First name" } },
      { type: "FreeTextQuestion", question_id: "q2", props: { label: "Last name" } },
    ]);
    const src2 = [
      `renderSaveFieldErrors([`,
      `  { path: 'content.components[0].internal_field', message: ${JSON.stringify(GENERIC)} },`,
      `  { path: 'content.components[1].internal_field', message: ${JSON.stringify(GENERIC)} }`,
      `]);`,
    ].join("\n");
    runInNewContext(src2, sandbox);
    const rows = box.children[1]!.children.map((li) => li.allText());
    expect(rows).toHaveLength(2);
    expect(rows[0], "row 1 must name its own component").toBe("First name: " + GENERIC);
    expect(rows[1], "row 2 must name its own (different) component").toBe("Last name: " + GENERIC);
    expect(rows[0]).not.toBe(rows[1]);
  });

  it("the summary line's verb agrees with the noun (N16: 'field needs attention' singular, 'fields need attention' plural)", () => {
    const { sandbox: s1, box: box1 } = buildSandbox([{ type: "FreeTextQuestion", question_id: "q1", props: {} }]);
    runInNewContext("renderSaveFieldErrors([{ path: 'headline_text', message: 'Headline is required' }])", s1);
    expect(box1.allText()).toContain("1 field needs attention");
    const { sandbox: s2, box: box2 } = buildSandbox([{ type: "FreeTextQuestion", question_id: "q1", props: {} }]);
    runInNewContext(
      "renderSaveFieldErrors([{ path: 'headline_text', message: 'a' }, { path: 'activity', message: 'b' }])",
      s2,
    );
    expect(box2.allText()).toContain("2 fields need attention");
  });
});

describe("P8 S5.2c — renderSaveProblems (warning path) is as honest AND as row-precise as the error path", () => {
  function run(problemsExpr: string, components: unknown[]) {
    const box = stubEl("div");
    const focused: string[] = [];
    const sandbox: Record<string, unknown> = {
      state: { content: { components } },
      selectComponent(qid: string) {
        focused.push(qid);
      },
      document: {
        querySelector(sel: string) {
          return sel === "[data-studio-save-problems]" ? box : null;
        },
        createElement(tag: string) {
          return stubEl(tag);
        },
        createTextNode(text: string) {
          return stubEl("#text", text);
        },
      },
    };
    const src = [
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "clearChildren"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "componentByProblemPath"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "saveProblemFocusHandler"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "renderSaveProblems"),
      `renderSaveProblems(${problemsExpr});`,
    ].join("\n");
    runInNewContext(src, sandbox);
    return box;
  }

  it("a clean already-operator-language warning is painted UNCHANGED (no transformation applied)", () => {
    const MSG = "Maps is on but no job is selected (validate/auction/autocomplete) — it does nothing at runtime. Pick a job or turn Maps off.";
    const box = run(`[{ path: 'components[0].props.maps', scope: 'component', severity: 'warning', message: ${JSON.stringify(MSG)} }]`, [
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: {} },
    ]);
    expect(box.allText()).toContain(MSG);
  });

  it("two frame-scope components sharing the IDENTICAL warning sentence now render two DIFFERENT rows", () => {
    const MSG = "The Header bar belongs to the funnel layout, not to this Section. Move it to the Quote Builder, or remove it here.";
    const box = run(
      [
        `[`,
        `  { path: 'components[0]', scope: 'component', severity: 'warning', message: ${JSON.stringify(MSG)} },`,
        `  { path: 'components[1]', scope: 'component', severity: 'warning', message: ${JSON.stringify(MSG)} }`,
        `]`,
      ].join("\n"),
      [
        { type: "HeaderBar", question_id: "q_hdr1" },
        { type: "FooterBar", question_id: "q_ftr1" },
      ],
    );
    const rows = box.children[1]!.children.map((li) => li.allText());
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toBe(rows[1]);
  });
});

describe("P8 S5.2c — the inspector/canvas name tag tells the truth for Phone and Address (contract §7 N16)", () => {
  // studioMeta's real label table (STUDIO_TYPE_META is not exported; these
  // four entries are copied VERBATIM from the source's own const — see
  // ui-section-studio.ts:342 — the code under test (scopeEditingName/
  // acceptFormatOfNode/typeLabel/typeMeta) is 100% real/sliced).
  const STUDIO_META_STUB = {
    types: {
      PhoneInputQuestion: { label: "Phone", description: "Phone number input." },
      AddressAutocompleteQuestion: { label: "Address", description: "Street address with Places autocomplete." },
      ZIPInputQuestion: { label: "ZIP", description: "5-digit ZIP input (Maps validation optional)." },
      TwoButtonYesNo: { label: "Yes / No", description: "Yes / No pair storing a boolean answer." },
    },
  };
  function probe() {
    const sandbox: Record<string, unknown> = { studioMeta: STUDIO_META_STUB };
    const src = [
      sliceIslandVar(SECTION_STUDIO_SCRIPT, "ACCEPT_TYPE_FORMAT"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "acceptFormatOfNode"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "typeMeta"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "typeLabel"),
      sliceIslandFunction(SECTION_STUDIO_SCRIPT, "scopeEditingName"),
      "var scopeState = 'component'; var choiceScopeLabel = '';",
    ].join("\n");
    runInNewContext(src, sandbox);
    return sandbox;
  }

  it("Phone and Address now show their OWN real name, not the generic 'Short text field'", () => {
    const sandbox = probe();
    expect(runInNewContext("scopeEditingName({ type: 'PhoneInputQuestion' })", sandbox)).toBe("Phone");
    expect(runInNewContext("scopeEditingName({ type: 'AddressAutocompleteQuestion' })", sandbox)).toBe("Address");
  });

  it("ZIP (the rest of the 8-value Accept-swap family) is UNCHANGED — still 'Short text field' (pinned elsewhere; never weaken)", () => {
    const sandbox = probe();
    expect(runInNewContext("scopeEditingName({ type: 'ZIPInputQuestion' })", sandbox)).toBe("Short text field");
  });

  it("a non-Accept-swap type is unaffected (control)", () => {
    const sandbox = probe();
    expect(runInNewContext("scopeEditingName({ type: 'TwoButtonYesNo' })", sandbox)).toBe("Yes / No");
  });
});

describe("P8 S5.2c — renderFunnelPicker's toggle-close never removeChild()s from the wrong parent (contract §7 N16)", () => {
  // A FAITHFUL removeChild stub (throws NotFoundError-like, exactly as the
  // real DOM does, unlike this test file's own lenient StubEl above) — the
  // only way to prove "checks the child exists but not that badge is its
  // parent" is a real defect is to make the stub enforce the SAME invariant
  // the real DOM enforces.
  function fakeElement(name: string) {
    const el: { name: string; children: unknown[]; parentNode: unknown; removeChild(c: unknown): void; querySelector(sel: string): unknown } = {
      name,
      children: [],
      parentNode: null,
      removeChild(c) {
        if (el.children.indexOf(c) === -1) {
          throw new Error(
            `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.`,
          );
        }
        el.children.splice(el.children.indexOf(c), 1);
      },
      querySelector() {
        return null;
      },
    };
    return el;
  }

  it("reproduces the adversarial condition: querySelector resolves a badge that is NOT oldPicker's real parent — the fixed code recovers instead of throwing", () => {
    // Two elements momentarily share one data-frame-badge qid (the class of
    // DOM shape componentByProblemPath-style querySelector cannot rule out —
    // see the fix's own comment). querySelector('[data-frame-badge="q1"]')
    // resolves badgeA (first match); the picker's REAL parent is badgeB.
    const badgeA = fakeElement("badgeA");
    const badgeB = fakeElement("badgeB");
    const picker = { name: "picker", parentNode: badgeB as unknown };
    badgeB.children.push(picker);
    badgeA.querySelector = (sel: string) => (sel === "[data-funnel-picker]" ? picker : null);

    const region = { querySelector: (sel: string) => (sel === '[data-frame-badge="q1"]' ? badgeA : null) };
    const sandbox: Record<string, unknown> = {
      canvasRegion() {
        return region;
      },
    };
    const src = [sliceIslandFunction(SECTION_STUDIO_SCRIPT, "renderFunnelPicker"), "renderFunnelPicker('q1', []);"].join("\n");
    expect(() => runInNewContext(src, sandbox), "the fixed guard must not throw").not.toThrow();
    // and it genuinely removed the picker from its REAL parent (not a no-op).
    expect(badgeB.children).toHaveLength(0);
  });
});
