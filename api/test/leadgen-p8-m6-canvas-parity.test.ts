// R2 P8 — M6 / R4: THE STUDIO CANVAS IS A FAITHFUL PREVIEW.
//
// Owner (docs/leadgen/source-of-truth): "the canvas should include one section
// in the middle so the user could see a real reference of how is design is
// gonna look like in real life".
//
// The two R4 rows this slice fixes are RESTING-STATE rows — what the visitor
// sees before touching anything:
//   * an authored `defaultValue` paints SELECTED (lg-selected / aria-checked
//     "true"); the canvas painted it unselected;
//   * a dependency-hidden question is NOT seen; the canvas painted it always.
// Both are produced on the live page by the client runtime (render.ts
// applySelectionClasses / applyComponentVisibility, called from engine.ts
// enterPage :1801/:1810/:1846), and the canvas iframe deliberately runs NO
// script (srcdoc `script-src 'none'`), so the fix emits the resting markup
// server-side instead of loosening that CSP.
//
// HOW THIS FILE AVOIDS THE "hand-built BOTH sides" FALSE GREEN (E10/E11).
// One authored fixture (CONTENT) feeds two REAL production paths; nothing
// below re-implements a renderer, a dependency rule or a default rule:
//   CANVAS  = studioCanvasDocument(...)  — the SSR first paint of the iframe,
//             the exported function the studio page itself calls; and the REAL
//             POST /api/admin/leadgen/sections/preview response for the REAL
//             body the REAL island function renderCanvasNow builds (sliced out
//             of the served island text and executed in a vm).
//   LIVE    = renderVariantSectionsHtml(...) — the exported function
//             serve.ts:722 uses for the visitor's shell — plus the resting
//             state the ENGINE computes over it, from the REAL modules the
//             engine itself consumes: config-dto toPublicComponent (which
//             produces `default_answer`, what applySectionDefaults seeds) and
//             runtime/dependencies evaluateComponents (what dependencyState
//             calls at engine.ts:1810).
// runtime/render.ts itself is DOM-lib browser code and cannot be imported into
// this typecheck program (tsconfig.json excludes the runtime dir; adding this
// file to tsconfig.runtime.json is outside this slice's owned set — the same
// constraint and the same note as leadgen-p8-m2-accent-role.test.ts:58). So
// the two class/attribute literals it writes are EXTRACTED FROM ITS SOURCE
// TEXT at test time (renderTsConst below) rather than retyped here: renaming
// SELECTED_CLASS or dropping the aria-checked write fails this file.
//
// FAIL-BEFORE (every change of this slice reverted: studioCanvasDocument back
// to renderSectionComponents, renderCanvasNow's `sim` removed, the <option>
// skip + the option-only ghost gate removed from decorateChoiceCards, the
// fills chip restored, the reach-a-hidden-question row removed):
//   npx vitest run test/leadgen-p8-m6-canvas-parity.test.ts
//   -> 11 failed | 3 passed (14), exit 1 — canvas selected="" vs live "true";
//      canvas aria-checked {"true":"false"} vs live {"true":"true"}; hidden
//      question painted true vs live false; 2 option-borne remove-x; a ghost
//      on the dropdown; no sim in the island's body; the chip present.
// PASS-AFTER: 14 passed (14), exit 0. Raw counts in the slice report.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";

import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  renderStudioCanvas,
  studioCanvasDocument,
  studioCanvasFrameSrcdoc,
  studioTypeMeta,
} from "../src/admin/leadgen/ui-section-studio";
import { renderVariantSectionsHtml } from "../src/public/leadgen/serve";
import type { ResolvedFunnelSection } from "../src/public/leadgen/resolver";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { toPublicComponent } from "../src/public/leadgen/config-dto";
import { evaluateComponents } from "../src/public/leadgen/runtime/dependencies";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";
import type {
  LeadgenComponentNode,
  LeadgenSectionContent,
} from "../src/public/leadgen/components/content-schema";
import { parseDom } from "./helpers/leadgen-visible-paint";
import type { ParsedEl } from "./helpers/leadgen-visible-paint";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DESIGN = getFunnelDesign(null);
const API = "/api/admin/leadgen";

// The served island text (this IS what the browser runs — the .ts holds it as
// a template literal), and the studio module source, both read from disk.
const STUDIO_SRC = readFileSync(
  join(TEST_DIR, "../src/admin/leadgen/ui-section-studio.ts"),
  "utf8",
);

// ---------------------------------------------------------------------------
// The live runtime's own literals, taken from runtime/render.ts's SOURCE (it
// cannot be imported here — see the header).
// ---------------------------------------------------------------------------

const RENDER_TS = readFileSync(
  join(TEST_DIR, "../src/public/leadgen/runtime/render.ts"),
  "utf8",
);

function renderTsConst(name: string): string {
  const m = RENDER_TS.match(new RegExp(`export const ${name} = "([^"]+)"`));
  expect(m, `runtime/render.ts exports ${name}`).not.toBeNull();
  return (m as RegExpMatchArray)[1] as string;
}

// applySelectionClasses (render.ts:92) writes exactly these two things on the
// answered question's chosen [data-lg-choice]: SELECTED_CLASS and
// aria-checked="true" (and "false" on the others).
const SELECTED_CLASS = renderTsConst("SELECTED_CLASS");
const SELECTION_FN = RENDER_TS.slice(
  RENDER_TS.indexOf("export function applySelectionClasses"),
  RENDER_TS.indexOf("export function updateRangeDisplay"),
);
const VISIBILITY_FN = RENDER_TS.slice(
  RENDER_TS.indexOf("export function applyComponentVisibility"),
  RENDER_TS.indexOf("export function applySelectionClasses"),
);

// ---------------------------------------------------------------------------
// One authored fixture. Rows 1 + 4 of the R4 table, plus the four families the
// contract records as ALREADY at parity ("these are correct, leave them").
// ---------------------------------------------------------------------------

const HEADLINE = "Are you insured?";

const CONTENT: LeadgenSectionContent = {
  components: [
    // R4 row 1 — an authored default. Resting: the "Yes" choice is selected.
    {
      type: "TwoButtonYesNo",
      question_id: "q_ins",
      internal_field: "currently_insured",
      answer_type: "boolean",
      props: { defaultValue: true },
    },
    // R4 row 4 — dependency-hidden at rest (the default above is true, so
    // `eq false` is unmet). The visitor never sees this until they answer No.
    {
      type: "ButtonAnswerGroup",
      question_id: "q_why",
      internal_field: "switch_reason",
      answer_type: "string",
      choices: [
        { label: "Price", value: "price", analytics_id: "why_price" },
        { label: "Service", value: "service", analytics_id: "why_service" },
      ],
      conditional: { when: "currently_insured", op: "eq", value: false },
    },
    // Unconditional, no default — must stay painted and unselected (the guard
    // against an over-eager filter).
    {
      type: "DropdownQuestion",
      question_id: "q_carrier",
      internal_field: "carrier",
      answer_type: "string",
      choices: [
        { label: "Geico", value: "geico", analytics_id: "car_geico" },
        { label: "Progressive", value: "progressive", analytics_id: "car_prog" },
      ],
    },
    // "leave them" families: slider value/position, currency affix, phone /
    // date / email, address attributes.
    {
      type: "NumberRangeQuestion",
      question_id: "q_budget",
      internal_field: "budget",
      answer_type: "number",
      props: { min: 0, max: 1000, step: 50, defaultValue: 400, default: 400 },
    },
    {
      type: "CurrencyInputQuestion",
      question_id: "q_price",
      internal_field: "price",
      answer_type: "currency",
      props: { currency: "$" },
    },
    { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "phone", answer_type: "string" },
    { type: "DateQuestion", question_id: "q_dob", internal_field: "dob", answer_type: "string" },
    { type: "EmailInputQuestion", question_id: "q_email", internal_field: "email", answer_type: "string" },
    {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      internal_field: "address",
      answer_type: "object",
      props: { maps: { enabled: true, jobs: { autocomplete: true } } },
    },
  ] as unknown as LeadgenComponentNode[],
};

const NODES = CONTENT.components as LeadgenComponentNode[];

// Content with NO default and NO conditional — the resting render must be
// byte-identical to the plain full render (the no-regression pin, containers
// included).
const PLAIN_CONTENT: LeadgenSectionContent = {
  components: [
    {
      type: "CardPanel",
      question_id: "panel1",
      props: { width: "m", background: "card", padding: "m" },
      children: [
        { type: "QuestionHeadline", question_id: "h1", props: { text: HEADLINE } },
        {
          type: "ButtonAnswerGroup",
          question_id: "b1",
          internal_field: "pick",
          answer_type: "string",
          choices: [{ label: "A", value: "a", analytics_id: "a" }],
        },
      ],
    },
  ] as unknown as LeadgenComponentNode[],
};

// ---------------------------------------------------------------------------
// Measurement instruments — applied IDENTICALLY to both sides.
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link", "source", "wbr"]);

/** The balanced [start,end) markup of the element carrying data-question-id=qid. */
function sliceQuestion(html: string, qid: string): string | null {
  const at = html.indexOf(`data-question-id="${qid}"`);
  if (at === -1) return null;
  const start = html.lastIndexOf("<", at);
  let depth = 0;
  let first = true;
  for (const m of html.slice(start).matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?>/g)) {
    const end = start + (m.index ?? 0) + m[0].length;
    const isClose = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const isVoid = !isClose && (VOID_TAGS.has(name) || m[0].endsWith("/>"));
    if (first) {
      if (isVoid) return html.slice(start, end);
      depth = 1;
      first = false;
      continue;
    }
    if (isVoid) continue;
    depth += isClose ? -1 : 1;
    if (depth === 0) return html.slice(start, end);
  }
  return null;
}

/** Painted question ids, in document order. */
function paintedQuestions(html: string): string[] {
  return [...html.matchAll(/data-lg-question="([^"]+)"/g)].map((m) => m[1] as string);
}

/** The choice values marked selected in this question's slice. */
function selectedChoices(html: string, qid: string): string[] {
  const slice = sliceQuestion(html, qid) ?? "";
  return parseDom(slice)
    .filter((el) => el.attrs.has("data-lg-choice") && el.classes.has(SELECTED_CLASS))
    .map((el) => el.attrs.get("data-lg-choice") ?? "");
}

function ariaChecked(html: string, qid: string): Record<string, string> {
  const slice = sliceQuestion(html, qid) ?? "";
  const out: Record<string, string> = {};
  for (const el of parseDom(slice)) {
    const choice = el.attrs.get("data-lg-choice");
    if (choice !== undefined && choice !== null && el.attrs.has("aria-checked")) {
      out[choice] = el.attrs.get("aria-checked") ?? "";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The LIVE side: the real shell renderer + the real resting state the engine
// computes over it.
// ---------------------------------------------------------------------------

function sectionRow(content: LeadgenSectionContent) {
  return {
    position: 0,
    section: {
      id: 1,
      public_id: "lgs_parity",
      section_name: "parity",
      activity: "auto",
      vertical: "insurance",
      headline_text: HEADLINE,
      subheadline_text: null,
      image_json: null,
      content_json: JSON.stringify(content),
      content_html: null,
      continue_mode: "button",
      design_overrides_json: null,
      address_validation_enabled: 0,
      section_mapping_version: 1,
      content_version: 1,
      status: "active",
      created_by: null,
      created_at: 0,
      updated_at: 0,
    },
  } as unknown as ResolvedFunnelSection;
}

/** serve.ts's own section renderer — the visitor's server-rendered markup. */
function liveHtml(content: LeadgenSectionContent): string {
  return renderVariantSectionsHtml([sectionRow(content)], DESIGN, null);
}

/**
 * The engine's resting state, computed with the engine's own collaborators:
 *  - answers  = every projected component's `default_answer` (config-dto), the
 *               exact loop applySectionDefaults runs (engine.ts:1877-1880);
 *  - visible  = evaluateComponents(components, answers) — dependencyState
 *               (engine.ts:978), whose output feeds applyComponentVisibility.
 * The projection cast is the config wire boundary itself: toPublicComponent is
 * the producer of #lg-config and LgComponentConfig is the runtime's reader type
 * for the same object.
 */
function liveResting(content: LeadgenSectionContent): {
  answers: Record<string, unknown>;
  visible: Set<string>;
} {
  const components = (content.components as LeadgenComponentNode[]).map((n) =>
    toPublicComponent(n),
  ) as unknown as LgComponentConfig[];
  const answers: Record<string, unknown> = {};
  for (const component of components) {
    const field = component.internal_field;
    if (field === undefined || field === "" || component.default_answer === undefined) continue;
    answers[field] = component.default_answer.value;
  }
  const state = evaluateComponents(components, answers);
  return {
    answers,
    visible: new Set(state.components.filter((c) => c.visible).map((c) => c.question_id)),
  };
}

// ---------------------------------------------------------------------------
// The CANVAS side: the SSR first paint + the real preview endpoint driven with
// the real island's own request body.
// ---------------------------------------------------------------------------

function canvasSsrHtml(content: LeadgenSectionContent): string {
  return studioCanvasDocument(content, DESIGN, { headline_text: HEADLINE, subheadline_text: null });
}

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

/** Execute the REAL renderCanvasNow and capture the body it POSTs. */
function islandCanvasBody(content: LeadgenSectionContent): Record<string, unknown> {
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const sandbox: Record<string, unknown> = {
    state: { content: JSON.parse(JSON.stringify(content)) as unknown },
    canvasViewport: "desktop",
    inlineEditing: false,
    JSON,
    document: { getElementById: () => null },
    fetch: (url: string, init: { body: string }) => {
      captured.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      // A synchronous thenable stub: renderCanvasNow only chains .then/.catch,
      // and this file measures the REQUEST, not the response handling.
      const chain = { then: () => chain, catch: () => chain };
      return chain;
    },
  };
  runInNewContext(
    [
      "function canvasRegion() { return { innerHTML: '' }; }",
      "function scheduleCanvasRender() {}",
      "function applyCanvasDecoration() {}",
      "function updateCanvasEmpty() {}",
      sliceIslandFunction("renderCanvasNow"),
      "renderCanvasNow();",
    ].join("\n"),
    sandbox,
  );
  expect(captured.length, "renderCanvasNow issued exactly one preview request").toBe(1);
  expect((captured[0] as { url: string }).url).toBe("/api/admin/leadgen/sections/preview");
  return (captured[0] as { body: Record<string, unknown> }).body;
}

function previewEnv(): Env {
  // The preview route touches no binding for a body with no frame_context /
  // theme_id (previewSectionHandler reads c.env.DB / c.env.CACHE only on those
  // two branches), so the bindings stay unusable stubs on purpose: if a future
  // change starts reading one here, this test throws instead of quietly
  // passing.
  return {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "test-only-signing-key",
  } as unknown as Env;
}

async function canvasEndpointHtml(body: Record<string, unknown>): Promise<string> {
  const res = await admin.request(
    `${API}/sections/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    previewEnv(),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const json = (await res.json()) as { preview: { html?: string; desktop?: string } };
  return json.preview.html ?? json.preview.desktop ?? "";
}

// ---------------------------------------------------------------------------
// 1. The resting-state parity table.
// ---------------------------------------------------------------------------

describe("M6/R4 — the canvas paints the visitor's resting state (same section, same moment)", () => {
  it("aspect table: authored default, dependency-hidden question, and the four 'leave them' families all match live", () => {
    const canvas = canvasSsrHtml(CONTENT);
    const live = liveHtml(CONTENT);
    const resting = liveResting(CONTENT);

    // The live resting facts, from the live modules (not from this file).
    expect(resting.answers).toEqual({ currently_insured: true, budget: 400 });
    expect(resting.visible.has("q_why"), "live hides q_why at rest").toBe(false);
    expect(resting.visible.has("q_ins"), "live shows q_ins at rest").toBe(true);

    const rows: Array<{ aspect: string; canvas: string; live: string; match: boolean }> = [];
    const row = (aspect: string, c: string, l: string): void => {
      rows.push({ aspect, canvas: c, live: l, match: c === l });
    };

    // R4 row 1 — the authored default.
    const canvasSelected = selectedChoices(canvas, "q_ins").join(",");
    const canvasAria = JSON.stringify(ariaChecked(canvas, "q_ins"));
    // Live at rest: applySelectionClasses(questionEl, <the resting answer>) —
    // SELECTED_CLASS + aria-checked "true" on the matching choice, "false" on
    // the rest. The value comes from the live projection; the class/attribute
    // names from render.ts's own source.
    const liveAnswer = String(resting.answers["currently_insured"]);
    const liveChoices = parseDom(sliceQuestion(live, "q_ins") ?? "")
      .filter((el) => el.attrs.has("data-lg-choice"))
      .map((el) => el.attrs.get("data-lg-choice") ?? "");
    expect(liveChoices, "the live Yes/No renders both choices").toEqual(["true", "false"]);
    const liveAria = JSON.stringify(
      Object.fromEntries(liveChoices.map((v) => [v, v === liveAnswer ? "true" : "false"])),
    );
    row("authored defaultValue -> selected class", canvasSelected, liveAnswer);
    row("authored defaultValue -> aria-checked", canvasAria, liveAria);

    // R4 row 4 — the dependency-hidden question.
    row(
      "dependency-hidden question painted",
      String(paintedQuestions(canvas).includes("q_why")),
      String(resting.visible.has("q_why")),
    );
    // ...and everything else IS painted.
    row(
      "visible question set",
      paintedQuestions(canvas).join(","),
      paintedQuestions(live)
        .filter((q) => resting.visible.has(q))
        .join(","),
    );

    // "these are correct, leave them" — byte-identical per-node markup.
    for (const [aspect, qid] of [
      ["slider value/position", "q_budget"],
      ["currency affix", "q_price"],
      ["phone", "q_phone"],
      ["date", "q_dob"],
      ["email", "q_email"],
      ["address attrs", "q_addr"],
      ["dropdown (no default)", "q_carrier"],
    ] as const) {
      const c = sliceQuestion(canvas, qid) ?? "<missing>";
      const l = sliceQuestion(live, qid) ?? "<missing>";
      rows.push({
        aspect: `${aspect} markup`,
        canvas: `${c.length}b`,
        live: `${l.length}b`,
        match: c === l,
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      ["aspect | canvas | live | match", "---|---|---|---"]
        .concat(rows.map((r) => `${r.aspect} | ${r.canvas} | ${r.live} | ${r.match ? "yes" : "NO"}`))
        .join("\n"),
    );

    for (const r of rows) {
      expect(r.match, `${r.aspect}: canvas=${r.canvas} live=${r.live}`).toBe(true);
    }
  });

  it("the canvas marks the default with the SAME class + attribute runtime/render.ts writes", () => {
    // Guards the two literals this parity depends on against a silent rename in
    // the live runtime: the mirror is asserted against render.ts's own text.
    expect(SELECTION_FN).toContain("SELECTED_CLASS");
    expect(SELECTION_FN).toContain('setAttribute("aria-checked", isOn ? "true" : "false")');
    expect(VISIBILITY_FN).toContain("toggleHidden(el, vis.visible)");
    const canvas = canvasSsrHtml(CONTENT);
    const slice = sliceQuestion(canvas, "q_ins") ?? "";
    expect(slice).toContain(`class="lg-btn lg-btn-answer ${SELECTED_CLASS}"`);
    expect(ariaChecked(canvas, "q_ins")).toEqual({ true: "true", false: "false" });
  });

  it("a dependency-hidden question contributes NO markup at all (not even hidden chrome)", () => {
    const canvas = canvasSsrHtml(CONTENT);
    expect(canvas).not.toContain('data-question-id="q_why"');
    expect(canvas).not.toContain("why_price");
    // and the trigger's other branch still exists in the model — flipping the
    // authored default to false reveals it, exactly as answering No does live.
    const flipped = JSON.parse(JSON.stringify(CONTENT)) as LeadgenSectionContent;
    (flipped.components[0] as LeadgenComponentNode).props = { defaultValue: false };
    const flippedCanvas = canvasSsrHtml(flipped);
    expect(flippedCanvas).toContain('data-question-id="q_why"');
    expect(liveResting(flipped).visible.has("q_why"), "live reveals it too").toBe(true);
  });

  it("content with no defaults and no conditionals renders byte-identically to the plain full render", () => {
    const plainNodes = PLAIN_CONTENT.components as LeadgenComponentNode[];
    const before = renderSectionComponents(plainNodes, DESIGN, {
      headline_text: HEADLINE,
      subheadline_text: null,
    });
    const canvas = canvasSsrHtml(PLAIN_CONTENT);
    expect(canvas).toContain(before);
  });
});

// ---------------------------------------------------------------------------
// 2. The island's own request, and SSR == endpoint.
// ---------------------------------------------------------------------------

describe("M6/R4 — one resting-state sequence for both canvas paints", () => {
  it("renderCanvasNow asks the preview endpoint for the resting state (sim.state=selected + an answers basis)", () => {
    const body = islandCanvasBody(CONTENT);
    expect(body["sim"]).toEqual({ state: "selected", answers: {} });
    expect(body["content_json"]).toBe(JSON.stringify(CONTENT));
    expect(body["viewport"]).toBe("desktop");
  });

  it("the SSR first paint byte-equals the preview endpoint's html for the island's own body", async () => {
    const body = islandCanvasBody(CONTENT);
    // the island sends the strip values; the SSR call gets the same ctx.
    body["headline"] = HEADLINE;
    const endpoint = await canvasEndpointHtml(body);
    const ssr = canvasSsrHtml(CONTENT);
    expect(ssr).toContain(endpoint);
  });

  it("the endpoint's resting html shows the same default-selected + dependency-hidden state", async () => {
    const body = islandCanvasBody(CONTENT);
    body["headline"] = HEADLINE;
    const html = await canvasEndpointHtml(body);
    expect(selectedChoices(html, "q_ins")).toEqual(["true"]);
    expect(html).not.toContain('data-question-id="q_why"');
  });
});

// ---------------------------------------------------------------------------
// 3. M7 — no editor chrome inside a native <option>.
// ---------------------------------------------------------------------------

// A minimal element host for the island's decoration pass, built FROM the real
// canvas markup (parseDom). It is plumbing only: the markup is the real
// renderer's output and the decoration is the real served island function.
class MiniEl {
  tagName: string;
  attrs: Record<string, string> = {};
  className = "";
  children: MiniEl[] = [];
  parentNode: MiniEl | null = null;
  style: Record<string, string> = {};
  type = "";
  hidden = false;
  text = "";
  listeners: Record<string, Array<() => void>> = {};
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  addEventListener(name: string, fn: () => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  click(): void {
    for (const fn of this.listeners["click"] ?? []) fn();
  }
  get firstChild(): MiniEl | null {
    return this.children[0] ?? null;
  }
  removeChild(child: MiniEl): MiniEl {
    const i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  /** Concatenated text of this element's subtree (createTextNode stubs). */
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  getAttribute(name: string): string | null {
    if (name === "class") return this.className;
    return this.attrs[name] ?? null;
  }
  setAttribute(name: string, value: string): void {
    if (name === "class") this.className = value;
    else this.attrs[name] = value;
  }
  appendChild(child: MiniEl): MiniEl {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child: MiniEl, ref: MiniEl | null): MiniEl {
    child.parentNode = this;
    const i = ref === null ? -1 : this.children.indexOf(ref);
    if (i === -1) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }
  get nextSibling(): MiniEl | null {
    const p = this.parentNode;
    if (p === null) return null;
    return p.children[p.children.indexOf(this) + 1] ?? null;
  }
  matches(selector: string): boolean {
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    const m = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
    if (m === null) return false;
    const name = m[1] as string;
    if (m[2] === undefined) return this.attrs[name] !== undefined;
    return this.attrs[name] === m[2];
  }
  closest(selector: string): MiniEl | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let cur: MiniEl | null = this;
    while (cur !== null) {
      if (selector.split(",").some((s) => cur !== null && cur.matches(s.trim()))) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  querySelectorAll(selector: string): MiniEl[] {
    const out: MiniEl[] = [];
    const walk = (el: MiniEl): void => {
      for (const c of el.children) {
        if (selector.split(",").some((s) => c.matches(s.trim()))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

/** Build a MiniEl tree out of REAL rendered markup. */
function miniDom(html: string): MiniEl {
  const parsed: ParsedEl[] = parseDom(html);
  const root = new MiniEl("div");
  const byIndex = new Map<number, MiniEl>();
  for (const p of parsed) {
    const el = new MiniEl(p.tag);
    for (const [k, v] of p.attrs) el.attrs[k] = v ?? "";
    el.className = [...p.classes].join(" ");
    byIndex.set(p.index, el);
    const parent = p.parent === null ? root : (byIndex.get(p.parent) as MiniEl);
    parent.appendChild(el);
  }
  return root;
}

function runDecoration(region: MiniEl): void {
  const sandbox: Record<string, unknown> = {
    region,
    selectedQuestionId: null,
    selectedChoiceValue: null,
    studioMeta: { max_depth: 4, types: studioTypeMeta() },
    String,
    document: {
      createElement: (t: string) => new MiniEl(t),
      createTextNode: (t: string) => {
        const n = new MiniEl("#text");
        n.text = t;
        return n;
      },
    },
  };
  runInNewContext(
    [
      "function canvasFrameDoc() { return null; }",
      sliceIslandFunction("frameCreate"),
      sliceIslandFunction("typeMeta"),
      sliceIslandFunction("decorateChoiceCards"),
      "decorateChoiceCards(region);",
    ].join("\n"),
    sandbox,
  );
}

describe("M7 — the canvas offers no control it cannot honour inside a native <option>", () => {
  it("the REAL decoration pass over the REAL dropdown markup adds no remove-x to any <option>", () => {
    const region = miniDom(canvasSsrHtml(CONTENT));
    const optionsBefore = region
      .querySelectorAll("[data-lg-choice]")
      .filter((el) => el.tagName === "OPTION");
    expect(optionsBefore.length, "the dropdown really does put data-lg-choice on <option>").toBeGreaterThan(0);

    runDecoration(region);

    const optionBorneX = region
      .querySelectorAll(".studio-choice-x")
      .filter((x) => x.parentNode !== null && x.parentNode.tagName === "OPTION");
    expect(optionBorneX.length, "no studio chrome inside a native <option>").toBe(0);
    // nothing else about the option is touched either
    for (const opt of optionsBefore) expect(opt.getAttribute("draggable")).toBeNull();
  });

  it("a dropdown gets no '+ Add choice' ghost; a button-family choice group still gets one", () => {
    const region = miniDom(canvasSsrHtml(CONTENT));
    runDecoration(region);
    const ghosts = region.querySelectorAll("[data-choice-ghost]").map((g) => g.getAttribute("data-choice-ghost"));
    expect(ghosts, "the option-only dropdown has no ghost").not.toContain("q_carrier");

    // The button family (rendered by the same real renderer) keeps both
    // affordances — this fix is scoped to the option-borne case.
    const buttonRegion = miniDom(
      renderSectionComponents(
        [
          {
            type: "ButtonAnswerGroup",
            question_id: "b1",
            internal_field: "pick",
            answer_type: "string",
            choices: [
              { label: "A", value: "a", analytics_id: "a" },
              { label: "B", value: "b", analytics_id: "b" },
            ],
          } as unknown as LeadgenComponentNode,
        ],
        DESIGN,
      ),
    );
    runDecoration(buttonRegion);
    expect(
      buttonRegion.querySelectorAll("[data-choice-ghost]").map((g) => g.getAttribute("data-choice-ghost")),
    ).toEqual(["b1"]);
    expect(buttonRegion.querySelectorAll(".studio-choice-x").length).toBe(2);
  });

  it("a choice group with NO choices yet keeps its ghost (that is when it is needed)", () => {
    const empty = miniDom(
      renderSectionComponents(
        [
          {
            type: "ButtonAnswerGroup",
            question_id: "b_empty",
            internal_field: "empty_pick",
            answer_type: "string",
            choices: [],
          } as unknown as LeadgenComponentNode,
        ],
        DESIGN,
      ),
    );
    runDecoration(empty);
    expect(
      empty.querySelectorAll("[data-choice-ghost]").map((g) => g.getAttribute("data-choice-ghost")),
    ).toEqual(["b_empty"]);
  });
});

// ---------------------------------------------------------------------------
// 4. A question the preview does not show is still reachable to AUTHOR —
//    outside the preview.
// ---------------------------------------------------------------------------

/** Run the REAL updateCanvasHiddenList over the REAL canvas markup. */
function runHiddenList(content: LeadgenSectionContent): {
  host: MiniEl;
  selected: string[];
} {
  const host = new MiniEl("div");
  const region = miniDom(canvasSsrHtml(content));
  const selected: string[] = [];
  const sandbox: Record<string, unknown> = {
    state: { content: JSON.parse(JSON.stringify(content)) as unknown },
    studioMeta: { max_depth: 4, types: studioTypeMeta() },
    String,
    document: {
      querySelector: (sel: string) => (sel === "[data-canvas-hidden]" ? host : null),
      createElement: (t: string) => new MiniEl(t),
      createTextNode: (t: string) => {
        const n = new MiniEl("#text");
        n.text = t;
        return n;
      },
    },
    selectComponent: (qid: string) => void selected.push(qid),
  };
  runInNewContext(
    [
      `function canvasRegion() { return region; }`,
      sliceIslandFunction("trimStr"),
      sliceIslandFunction("clearChildren"),
      sliceIslandFunction("typeMeta"),
      sliceIslandFunction("typeLabel"),
      sliceIslandFunction("isContainerType"),
      sliceIslandFunction("walkTree"),
      sliceIslandFunction("hiddenPickHandler"),
      sliceIslandFunction("updateCanvasHiddenList"),
      "updateCanvasHiddenList();",
    ].join("\n"),
    { ...sandbox, region },
  );
  return { host, selected };
}

describe("M6/R4 — the withheld question stays authorable, outside the preview", () => {
  it("the canvas panel (parent page, not the iframe) hosts the reach-it row", () => {
    const page = renderStudioCanvas(CONTENT, DESIGN, {
      headline_text: HEADLINE,
      subheadline_text: null,
    });
    expect(page).toContain('data-canvas-hidden hidden');
    // it is a SIBLING of the iframe inside the canvas panel, never inside the
    // srcdoc the owner reads as the preview
    expect(page.indexOf("data-canvas-hidden")).toBeGreaterThan(page.indexOf("lg-studio-canvas-frame"));
    expect(
      studioCanvasFrameSrcdoc(CONTENT, DESIGN, { headline_text: HEADLINE, subheadline_text: null }),
    ).not.toContain("data-canvas-hidden");
  });

  it("lists exactly the question the resting render withheld, and clicking it selects that question", () => {
    const { host, selected } = runHiddenList(CONTENT);
    expect(host.hidden).toBe(false);
    const picks = host.querySelectorAll("[data-canvas-hidden-pick]");
    expect(picks.map((p) => p.getAttribute("data-canvas-hidden-pick"))).toEqual(["q_why"]);
    expect(host.textContent).toContain("Not on the page at the start");
    (picks[0] as MiniEl).click();
    expect(selected).toEqual(["q_why"]);
  });

  it("stays hidden when the resting render withholds nothing", () => {
    const flipped = JSON.parse(JSON.stringify(CONTENT)) as LeadgenSectionContent;
    (flipped.components[0] as LeadgenComponentNode).props = { defaultValue: false };
    const { host } = runHiddenList(flipped);
    expect(host.querySelectorAll("[data-canvas-hidden-pick]").length).toBe(0);
    expect(host.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. The fills chip is gone from the preview surface.
// ---------------------------------------------------------------------------

describe("M6/R4 — injected editor chrome the live page has no equivalent for", () => {
  it("applyCanvasDecoration injects no 'fills:' chip into the canvas (the Maps tab owns that)", () => {
    const decoration = sliceIslandFunction("applyCanvasDecoration");
    expect(decoration).not.toContain("data-studio-maps-chip");
    expect(decoration).not.toContain("data-fills");
    expect(decoration).not.toContain("createTextNode('fills");
    // exactly ONE mention left in CODE (comments stripped), and it is the
    // stale-sweep that clears a chip injected by a page loaded before this fix
    // — never a creation.
    const codeOnly = decoration
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect((codeOnly.match(/studio-maps-chip/g) ?? []).length).toBe(1);
    expect(decoration).toContain(".studio-maps-chip, .studio-frame-badge");
    // the authoring surface it moved to still exists, outside the preview
    expect(STUDIO_SRC).toContain("data-maps-fills-block");
    // the canvas stylesheet no longer ships a rule for a chip nothing paints
    expect(STUDIO_SRC).not.toContain(".studio-maps-chip{");
  });
});
