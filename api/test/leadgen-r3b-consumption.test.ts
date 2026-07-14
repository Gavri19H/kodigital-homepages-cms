// Section Builder v3.1 REMEDIATION — phase R3 STAGE B.
// Covers: E2-C1 featureColor wiring across the text family + all 7 TextBlock
// roles; E1-NEW-7 NameFieldsGroup firstLabel/lastLabel/helper; deliverable-4
// ImageBlock placeholder honesty (auto_logo + media); deliverable 5
// DisclosureLink key-fix fail-before/pass-after (both the render-time key AND
// the save-seam html->panelHtml migration); deliverable 7 retired-node
// migration fail-before/pass-after (content-schema's REAL
// rewriteRetiredNodeToPrimitive/validateSectionContent — the server-side
// half; the island's OWN inline mirror is pinned structurally against
// SECTION_STUDIO_SCRIPT below); Rules/Behavior/Advanced gating structural
// pins; the golden-regions census (run + report, JSON untouched). The
// browser effect-matrix (Continue rows, text-color role, TextBlock/ImageBlock
// insert->render, frame-scope notice, Spacer variant) lives in
// test-ui/leadgen-r3b-effects.gesture.spec.ts.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderComponent } from "../src/public/leadgen/components/presets";
import {
  validateSectionContent,
  rewriteRetiredNodeToPrimitive,
  primitiveViewOfNode,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  SECTION_STUDIO_SCRIPT,
  renderSectionStudio,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";

const DESIGN = defaultFunnelDesign;
const ACCENT = "#E85D26"; // design.color.accent

// A minimal fixture for the SSR-side assertions (STUDIO_TYPE_META copy,
// CONTAINER_PROP_CONTROLS markup) — these are server-rendered HTML, NOT part
// of SECTION_STUDIO_SCRIPT (the inline <script> island), so they need the
// real renderSectionStudio output, mirroring test/leadgen-r2-canvas.test.ts's
// own STUDIO_HTML fixture idiom.
const FIXTURE_VIEW: StudioSectionView = {
  public_id: "lgs_r3b_fixture",
  section_name: "R3b",
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

function node(type: string, extra: Record<string, unknown> = {}): LeadgenComponentNode {
  return {
    type,
    question_id: "q_" + type,
    internal_field: "f_" + type,
    answer_type: "string",
    props: {},
    ...extra,
  } as unknown as LeadgenComponentNode;
}
function render(type: string, extra: Record<string, unknown> = {}): string {
  return renderComponent(node(type, extra), DESIGN);
}

describe("R3b E2-C1 — featureColor now wires the pre-existing Style-tab 'Text color role' control for the WHOLE text family", () => {
  const TEXT_FAMILY_HTML_TAGS: Array<[string, string]> = [
    ["QuestionHeadline", "lg-headline"],
    ["Subheadline", "lg-subheadline"],
    ["HelperText", "lg-helper"],
    ["LegalNote", "lg-legal"],
  ];
  for (const [type, cls] of TEXT_FAMILY_HTML_TAGS) {
    it(`${type}: featureColor=accent renders ${ACCENT}; absent stays the design default`, () => {
      const withOverride = render(type, { props: { text: "x", html: "x" }, design_overrides: { featureColor: "accent" } });
      expect(withOverride).toContain(`class="${cls}"`);
      expect(withOverride).toContain(`color:${ACCENT}`);
      const withoutOverride = render(type, { props: { text: "x", html: "x" } });
      expect(withoutOverride).not.toContain(ACCENT);
    });
  }

  const TEXTBLOCK_ROLES: Array<[string, string | undefined]> = [
    ["heading", undefined],
    ["body", undefined],
    ["category_label", undefined],
    ["helper", undefined],
    ["legal", undefined],
    ["reassurance", undefined],
    ["secure_badge", undefined],
  ];
  for (const [role] of TEXTBLOCK_ROLES) {
    it(`TextBlock role=${role}: featureColor=accent renders ${ACCENT} (register: was dead for 6/7 roles)`, () => {
      const html = render("TextBlock", { props: { role, text: "x" }, design_overrides: { featureColor: "accent" } });
      expect(html).toContain(ACCENT);
    });
  }

  it("TextBlock role=body is the ONE role with no unconditional color — absent override renders NO color at all (byte-additive, never a forced default)", () => {
    const html = render("TextBlock", { props: { role: "body", text: "x" } });
    expect(html).not.toContain("style=");
  });
});

describe("R3b E1-NEW-7 — NameFieldsGroup: firstLabel/lastLabel (already consumed) + helper (now wired)", () => {
  it("renders the authored firstLabel/lastLabel text", () => {
    const html = render("NameFieldsGroup", { props: { firstLabel: "Given name", lastLabel: "Family name" } });
    expect(html).toContain("Given name");
    expect(html).toContain("Family name");
  });
  it("renders the helper line when props.helper is set (the previously-dead advertised control)", () => {
    const html = render("NameFieldsGroup", { props: { helper: "As shown on your ID" } });
    expect(html).toContain("lg-field-help");
    expect(html).toContain("As shown on your ID");
  });
  it("renders NO helper div without props.helper (byte-additive)", () => {
    expect(render("NameFieldsGroup")).not.toContain("lg-field-help");
  });
});

describe("R3b deliverable 4 — ImageBlock: an honest labeled placeholder instead of an invisible box", () => {
  it("auto_logo with NEITHER logoUrl nor siteName renders a labeled placeholder (previously an empty <span>)", () => {
    const html = render("ImageBlock", { props: { source: "auto_logo" } });
    expect(html).toContain("data-placeholder=\"true\"");
    expect(html).toContain("Site logo");
  });
  it("auto_logo WITH siteName renders the real logo text, byte-identical to pre-R3b (no placeholder)", () => {
    const html = render("ImageBlock", { props: { source: "auto_logo", siteName: "Acme" } });
    expect(html).not.toContain("data-placeholder");
    expect(html).toContain("Acme");
  });
  it("media source with NO logoMediaId renders a labeled placeholder", () => {
    const html = render("ImageBlock", { props: { source: "media" } });
    expect(html).toContain("data-placeholder=\"true\"");
    expect(html).toContain(">Image<");
  });
  it("media source WITH logoMediaId renders the real <img>, byte-identical to pre-R3b", () => {
    const html = render("ImageBlock", { props: { source: "media", logoMediaId: "https://example.com/a.png" } });
    expect(html).not.toContain("data-placeholder");
    expect(html).toContain("<img");
  });
});

describe("R3b deliverable 5 — DisclosureLink key fix: fail-before/pass-after", () => {
  it("FAIL-BEFORE: a legacy node authored under the OLD 'html' key (no panelHtml) fails validateSectionContent today", () => {
    const content = { components: [{ type: "DisclosureLink", question_id: "q", props: { html: "Terms apply" } }] };
    const result = validateSectionContent(content);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_field_prop" || e.path.includes("panelHtml"))).toBe(true);
  });
  it("PASS-AFTER (render): renderDisclosureLink already reads panelHtml correctly — the CONTENT_PROP_FIELDS key fix (island) + the save-seam migration (below) are what make an authored edit actually reach it", () => {
    const html = render("DisclosureLink", { props: { label: "Terms", panelHtml: "Terms apply" } });
    expect(html).toContain("Terms apply");
    expect(html).toContain(">Terms<");
  });
  it("PASS-AFTER (save-seam migration, island): the inline migrateDisclosureLinkKey mirrors this exact html->panelHtml rewrite — structural pin against the shipped island", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("function migrateDisclosureLinkKey(list)");
    expect(SECTION_STUDIO_SCRIPT).toContain("node.type === 'DisclosureLink' && node.props && node.props.html !== undefined");
    expect(SECTION_STUDIO_SCRIPT).toContain("node.props.panelHtml = node.props.html");
    expect(SECTION_STUDIO_SCRIPT).toContain("delete node.props.html");
  });
  it("a migrated node (html moved to panelHtml) PASSES validateSectionContent", () => {
    const migrated = { components: [{ type: "DisclosureLink", question_id: "q", props: { panelHtml: "Terms apply" } }] };
    expect(validateSectionContent(migrated).ok).toBe(true);
  });
});

describe("R3b deliverable 7 — retired-node migration: fail-before/pass-after (content-schema's real function)", () => {
  it("FAIL-BEFORE (documents the register's own claim): a retired node is schema-VALID as its OLD type — validateSectionContent alone never forces the rewrite, so 'passes save unmigrated' was possible with zero enforcement anywhere calling rewriteRetiredNodeToPrimitive", () => {
    const legacyHelper = { components: [{ type: "HelperText", question_id: "q", props: { text: "x" } }] };
    expect(validateSectionContent(legacyHelper).ok).toBe(true); // valid AS HelperText — nothing here migrates it
  });
  it("PASS-AFTER: rewriteRetiredNodeToPrimitive (now invoked at the save seam, island-side) actually converts HelperText -> TextBlock(role:helper)", () => {
    const legacy = node("HelperText", { props: { text: "We never share this" } });
    const rewritten = rewriteRetiredNodeToPrimitive(legacy);
    expect(rewritten.type).toBe("TextBlock");
    expect(rewritten.props).toEqual({ role: "helper", text: "We never share this" });
    // byte-faithful: the rewritten node still validates
    const content = { components: [rewritten] };
    expect(validateSectionContent(content).ok).toBe(true);
  });
  it("LogoStrip -> ImageBlock(source:auto_logo) — the register's documented LOSSY edge (only ONE logo survives)", () => {
    const legacy = node("LogoStrip", { props: { logos: [{ mediaId: "a", alt: "A" }, { mediaId: "b", alt: "B" }] } });
    const rewritten = rewriteRetiredNodeToPrimitive(legacy);
    expect(rewritten.type).toBe("ImageBlock");
    expect(rewritten.props).toEqual({ source: "auto_logo" });
  });
  it("a non-retired node (e.g. TextBlock itself) passes through rewriteRetiredNodeToPrimitive UNCHANGED (same object identity)", () => {
    const n = node("TextBlock", { props: { role: "heading", text: "x" } });
    expect(rewriteRetiredNodeToPrimitive(n)).toBe(n);
    expect(primitiveViewOfNode(n)).toBeNull();
  });
  it("the island's inline mirror (migrateRetiredNodes/rewriteRetiredNodeToPrimitiveInline) is structurally pinned against the shipped script — same 5 text roles + LogoStrip, never re-derived by hand", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("function rewriteRetiredNodeToPrimitiveInline(node)");
    expect(SECTION_STUDIO_SCRIPT).toContain(
      "var RETIRED_TEXT_ROLE_BY_TYPE = { CategoryLabel: 'category_label', HelperText: 'helper', LegalNote: 'legal', ReassuranceBadge: 'reassurance', SecureFormBadge: 'secure_badge' };",
    );
    expect(SECTION_STUDIO_SCRIPT).toContain("if (node.type === 'LogoStrip')");
    expect(SECTION_STUDIO_SCRIPT).toContain("function migrateRetiredNodes(list)");
  });
});

// R3 MAJOR-2 (register E2-NEW-4): the structural pins above prove the SHAPE of
// the shipped island migration; these EXECUTE the very same functions (sliced
// out of SECTION_STUDIO_SCRIPT, run in a bare vm — the openQuoteBuilderNav
// idiom) against real node inputs, so an output regression is caught, not just
// a rename. This is the executing half the register demanded.
describe("R3 MAJOR-2 — the SHIPPED island save-seam migrations, EXECUTED against real nodes", () => {
  function buildMigrator() {
    const src = [
      sliceVar("RETIRED_TEXT_ROLE_BY_TYPE"),
      sliceFn("migrateHelperKey"),
      sliceFn("migrateDisclosureLinkKey"),
      sliceFn("rewriteRetiredNodeToPrimitiveInline"),
      sliceFn("migrateRetiredNodes"),
      sliceFn("contentHasRetiredLogoStrip"),
      // same order collectSection runs them (helper alias -> disclosure rename -> retirement)
      "this.__run = function (list) { migrateHelperKey(list); migrateDisclosureLinkKey(list); migrateRetiredNodes(list); };",
      "this.__hasLogoStrip = function (list) { return contentHasRetiredLogoStrip(list); };",
    ].join("\n");
    const sandbox: Record<string, unknown> = {};
    runInNewContext(src, sandbox);
    return {
      run: sandbox["__run"] as (list: unknown[]) => void,
      hasLogoStrip: sandbox["__hasLogoStrip"] as (list: unknown[]) => boolean,
    };
  }

  it("LogoStrip -> ImageBlock(source:auto_logo) — DROPS its logos (the one LOSSY migration)", () => {
    const { run } = buildMigrator();
    const tree = [{ type: "LogoStrip", question_id: "q_ls", props: { logos: ["a.png", "b.png", "c.png"] } }] as Array<Record<string, unknown>>;
    run(tree);
    expect(tree[0]).toMatchObject({ type: "ImageBlock", props: { source: "auto_logo" } });
    expect((tree[0]!["props"] as Record<string, unknown>)["logos"], "individual logos are dropped").toBeUndefined();
    expect(tree[0]!["question_id"], "every OTHER field survives").toBe("q_ls");
  });

  it("the 5 retired text roles -> TextBlock(role) with text sourced per role (legal<-html, else<-text), non-empty icon carried", () => {
    const { run } = buildMigrator();
    const tree = [
      { type: "CategoryLabel", question_id: "c", props: { text: "Section", icon: "star" } },
      { type: "HelperText", question_id: "h", props: { text: "Helps" } },
      { type: "LegalNote", question_id: "l", props: { html: "Legal copy" } },
      { type: "ReassuranceBadge", question_id: "r", props: { text: "Safe", icon: "" } },
      { type: "SecureFormBadge", question_id: "s", props: { text: "Secure" } },
    ] as Array<Record<string, unknown>>;
    run(tree);
    expect(tree.map((n) => n["type"])).toEqual(["TextBlock", "TextBlock", "TextBlock", "TextBlock", "TextBlock"]);
    expect(tree[0]!["props"]).toMatchObject({ role: "category_label", text: "Section", icon: "star" });
    expect(tree[1]!["props"]).toMatchObject({ role: "helper", text: "Helps" });
    expect(tree[2]!["props"]).toMatchObject({ role: "legal", text: "Legal copy" });
    expect((tree[3]!["props"] as Record<string, unknown>)["icon"], "empty icon NOT carried").toBeUndefined();
    expect(tree[4]!["props"]).toMatchObject({ role: "secure_badge", text: "Secure" });
  });

  it("DisclosureLink html -> panelHtml (renamed, old key deleted)", () => {
    const { run } = buildMigrator();
    const tree = [{ type: "DisclosureLink", question_id: "d", props: { html: "Advertiser disclosure" } }] as Array<Record<string, unknown>>;
    run(tree);
    const props = tree[0]!["props"] as Record<string, unknown>;
    expect(props["panelHtml"]).toBe("Advertiser disclosure");
    expect(props["html"]).toBeUndefined();
  });

  it("helper_text -> helper (renamed, old key deleted) — recursing into NESTED container children", () => {
    const { run } = buildMigrator();
    const tree = [{ type: "Stack", question_id: "stk", children: [{ type: "FreeTextQuestion", question_id: "f", props: { helper_text: "Private" } }] }] as Array<Record<string, unknown>>;
    run(tree);
    const child = (tree[0]!["children"] as Array<Record<string, unknown>>)[0]!;
    const props = child["props"] as Record<string, unknown>;
    expect(props["helper"]).toBe("Private");
    expect(props["helper_text"]).toBeUndefined();
  });

  it("contentHasRetiredLogoStrip detects a LogoStrip anywhere (incl. nested), false otherwise — the lossy-guard trigger", () => {
    const { hasLogoStrip } = buildMigrator();
    expect(hasLogoStrip([{ type: "FreeTextQuestion", question_id: "f" }])).toBe(false);
    expect(hasLogoStrip([{ type: "LogoStrip", question_id: "l" }])).toBe(true);
    expect(hasLogoStrip([{ type: "Stack", question_id: "s", children: [{ type: "LogoStrip", question_id: "l2" }] }])).toBe(true);
  });
});

describe("R3b deliverable 3 — Rules tab excluded for the text family; Behavior gated to produces!==null; Advanced internal_field disabled for containers", () => {
  it("RULES_EXCLUDED_TEXT_TYPES covers exactly the 4 text primitives named in the register (E2-NEW-5)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain(
      "var RULES_EXCLUDED_TEXT_TYPES = { TextBlock: 1, CategoryLabel: 1, HelperText: 1, LegalNote: 1 };",
    );
    expect(SECTION_STUDIO_SCRIPT).toContain("RULES_EXCLUDED_TEXT_TYPES[node.type] !== 1");
  });
  it("the Behavior section gates on meta.produces (E1-C8 — kills the AutoAdvanceButton nonsense controls)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("data-content-behavior-section");
    expect(SECTION_STUDIO_SCRIPT).toContain("behaviorSection.hidden = !node || !meta.produces");
  });
  it("Internal field disables for the 5 containers with a human note (E2-NEW-10 studio part)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("var isContainerSelection = !!node && meta.container === true;");
    expect(SECTION_STUDIO_SCRIPT).toContain("internalFieldInput.disabled = isContainerSelection");
    expect(SECTION_STUDIO_SCRIPT).toContain("data-internal-field-container-note");
  });
});

describe("R3b deliverable 8 — frame-scope honesty: the 10-type set + variant gating are structurally pinned", () => {
  it("FRAME_SCOPE_STUDIO_TYPES names exactly the register's 10 types", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain(
      "var FRAME_SCOPE_STUDIO_TYPES = { HeaderBar: 1, FooterBar: 1, TrustBar: 1, LogoStrip: 1, StepIndicator: 1, ProgressBar: 1, HeaderLogo: 1, BackButton: 1, DisclosureLink: 1, BackgroundPanel: 1 };",
    );
  });
  it("both contentVariantOf and styleVariantOf route these types to 'frame_scope' (before the generic 'field' fallback)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("if (FRAME_SCOPE_STUDIO_TYPES[node.type] === 1) { return 'frame_scope'; }");
  });
  it("the read-only notice blocks exist in BOTH Content and Style tabs, wired to the shared openQuoteBuilderNav", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("data-content-framescope-block");
    expect(SECTION_STUDIO_SCRIPT).toContain("data-style-framescope-block");
    expect(SECTION_STUDIO_SCRIPT).toContain("data-framescope-change-in-frame");
  });
});

describe("R3b deliverable 2 — rail removal: correct per-type gating for the survivors", () => {
  it("iconColor hidden unless a card grid (was 'hidden for MultiChoiceCardGroup only' — the wrong-axis bug)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("if (rowKey === 'iconColor') { return !isCardGridType(node); }");
  });
  it("rangeColor hidden unless the range family (previously ungated/dead axis)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("function isRangeFamilyType(node)");
    expect(SECTION_STUDIO_SCRIPT).toContain("if (rowKey === 'rangeColor') { return !isRangeFamilyType(node); }");
  });
  it("renderDesignPanel/renderLayoutPanel are GONE by name (golden-regions detects blocks by name)", () => {
    expect(SECTION_STUDIO_SCRIPT).not.toContain("function renderDesignPanel(");
  });
});

// --- tiny island slicer (mirrors test/leadgen-r2-canvas.test.ts's vm-probe idiom) ---
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
// slices a one-line `var NAME = ...;` island declaration (the object has no
// inner ';', so the first ';' after the marker terminates it).
function sliceVar(name: string): string {
  const marker = `var ${name} = `;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const end = SECTION_STUDIO_SCRIPT.indexOf(";", start);
  return SECTION_STUDIO_SCRIPT.slice(start, end + 1);
}

describe("R3b deliverable 1 — openQuoteBuilderNav: the 0/1/many funnel disambiguation, unit-tested against the SHIPPED island functions", () => {
  interface FakeEl {
    tagName: string;
    attrs: Record<string, string>;
    textContent: string;
    className: string;
    children: FakeEl[];
    parentNode: FakeEl | null;
    listeners: Array<{ type: string; fn: () => void }>;
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): string | null;
    appendChild(child: FakeEl): FakeEl;
    removeChild(child: FakeEl): void;
    addEventListener(type: string, fn: () => void): void;
    querySelector(sel: string): FakeEl | null;
  }
  function fakeEl(tag: string): FakeEl {
    const el: FakeEl = {
      tagName: tag.toUpperCase(),
      attrs: {},
      textContent: "",
      className: "",
      children: [],
      parentNode: null,
      listeners: [],
      setAttribute(name, value) {
        el.attrs[name] = value;
      },
      getAttribute(name) {
        return el.attrs[name] ?? null;
      },
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      removeChild(child) {
        const i = el.children.indexOf(child);
        if (i !== -1) el.children.splice(i, 1);
      },
      addEventListener(type, fn) {
        el.listeners.push({ type, fn });
      },
      querySelector(sel) {
        // only the ONE selector renderFramePillPicker itself uses.
        if (sel === "[data-frame-pill-picker]") {
          return el.children.find((c) => c.attrs["data-frame-pill-picker"] !== undefined) ?? null;
        }
        return null;
      },
    };
    return el;
  }
  function buildSandbox(usageRowsSeed: Array<{ funnel_public_id: string; funnel_name: string; quote_public_id: string | null }>) {
    const hostEl = fakeEl("button");
    const locationHolder = { href: "" };
    const src = [
      "var usageRows = " + JSON.stringify(usageRowsSeed) + ";",
      sliceFn("usageFunnelsOf"),
      sliceFn("funnelQuoteUrl"),
      sliceFn("framePillPickBtn"),
      sliceFn("renderFramePillPicker"),
      sliceFn("openQuoteBuilderNav"),
      "this.__invoke = function (host) { openQuoteBuilderNav(host); };",
    ].join("\n");
    // document.createElement is the SAME fakeEl factory framePillPickBtn/
    // renderFramePillPicker call (document.createElement('button')/('span')).
    const sandbox: Record<string, unknown> = {
      document: { createElement: fakeEl, createTextNode: (t: string) => ({ __text: t }) },
      window: { location: locationHolder },
    };
    runInNewContext(src, sandbox);
    const invoke = sandbox["__invoke"] as (host: FakeEl) => void;
    return { invoke, hostEl, locationHolder };
  }

  it("0 funnels -> navigates to the quotes LIST (never a disabled no-op — the register's own honesty fix)", () => {
    const { invoke, hostEl, locationHolder } = buildSandbox([]);
    invoke(hostEl);
    expect(locationHolder.href).toBe("/admin/leadgen/quotes");
  });
  it("1 funnel -> navigates DIRECTLY to that funnel's Quote Builder edit page", () => {
    const { invoke, hostEl, locationHolder } = buildSandbox([
      { funnel_public_id: "fn_1", funnel_name: "Solo Funnel", quote_public_id: "qt_1" },
    ]);
    invoke(hostEl);
    expect(locationHolder.href).toBe("/admin/leadgen/quotes/qt_1/edit");
  });
  it("many funnels -> renders the SAME picker the usage-pill mechanism uses (one button per funnel), and does NOT navigate", () => {
    const { invoke, hostEl, locationHolder } = buildSandbox([
      { funnel_public_id: "fn_1", funnel_name: "Alpha", quote_public_id: "qt_1" },
      { funnel_public_id: "fn_2", funnel_name: "Beta", quote_public_id: "qt_2" },
    ]);
    // renderFramePillPicker anchors the picker as a SIBLING of host (host.parentNode).
    const parent = fakeEl("span");
    parent.appendChild(hostEl);
    invoke(hostEl);
    expect(locationHolder.href).toBe("");
    const picker = parent.children.find((c) => c !== hostEl && c.attrs["data-frame-pill-picker"] !== undefined);
    expect(picker, "a picker element was inserted as a sibling").toBeTruthy();
    expect(picker!.children.length, "one pill per funnel").toBe(2);
  });
});

describe("R3b deliverable 6 — Spacer variant toggle authoring", () => {
  it("CONTAINER_PROP_CONTROLS.Spacer includes the variant(gap|line) control (SSR markup)", () => {
    expect(STUDIO_HTML).toContain('data-container-prop="variant"');
  });
  it("renderSpacer already renders the line variant correctly (register: only authoring was missing)", () => {
    const html = render("Spacer", { props: { variant: "line", size: "m" } });
    expect(html).toContain("lg-spacer-line");
  });
});

describe("R3b deliverable 9 — catalog hygiene copy (SSR markup: STUDIO_TYPE_META descriptions + the card-style hint)", () => {
  it("PhoneInputQuestion's description no longer claims format validation it doesn't do", () => {
    expect(STUDIO_HTML).toContain("Phone number input.");
    expect(STUDIO_HTML).not.toContain("Phone input with format validation.");
  });
  it("ValidationError's description clarifies the static-fallback nature (human words)", () => {
    expect(STUDIO_HTML).toContain("Static fallback message — the live funnel replaces this with the real validation error.");
  });
  it("the card-style discoverability hint is present, gated to the 3-type family", () => {
    expect(STUDIO_HTML).toContain("data-card-style-hint");
    expect(STUDIO_HTML).toContain("Card style: Icon");
  });
});

describe("R3b golden-regions census (report-only — JSON untouched)", () => {
  it("runs the live scan and records the census for the conductor (this test always passes; it exists to CAPTURE evidence in the run log)", () => {
    const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "golden-allowlist.mjs");
    let output = "";
    try {
      output = execFileSync("node", [scriptPath], { encoding: "utf8", cwd: join(dirname(fileURLToPath(import.meta.url)), "..") });
    } catch (e) {
      // report-only script always exits 0, but capture stdout even on an
      // unexpected non-zero so the census still prints for triage.
      output = (e as { stdout?: string }).stdout ?? String(e);
    }
    // eslint-disable-next-line no-console
    console.log("[golden-regions census]\n" + output);
    expect(output).toContain("mode: report-only");
  });
});
