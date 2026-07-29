// Section Builder product-core remediation, phase P4d — PC-A8 (NameFieldsGroup
// per-field placeholder/helper/icon) + PC-A10 (drift honesty: the Studio's
// dedicated block, the hasContent tab carve-out, the TextBlock icon gate, the
// registry doc-row correction). The presets.ts render matrix + the r3a-
// consumption drift pin (SearchableDropdown/Range helper wiring) live in
// leadgen-r3b-consumption.test.ts / leadgen-r3a-consumption.test.ts
// respectively (extended in place, per the register's own file grounding);
// this file covers the NEW per-field schema/render surface + the studio-side
// structural pins those two renderer suites do not touch.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import { SECTION_STUDIO_SCRIPT, renderStudioInspector } from "../src/admin/leadgen/ui-section-studio";
import type { FunnelDesign } from "../src/public/leadgen/designs/registry";

// CONTENT_PROP_FIELDS is a server-only TS const, never embedded in the client
// SECTION_STUDIO_SCRIPT template string — the only way to pin its exact
// NameFieldsGroup entry structurally (without exporting an internal just for
// a test) is to read the real committed source, the same sliceVarLine idiom
// leadgen-r2-canvas.test.ts already uses for a different top-level const.
function contentPropFieldsSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "../src/admin/leadgen/ui-section-studio.ts"), "utf8");
  const start = src.indexOf("const CONTENT_PROP_FIELDS");
  const end = src.indexOf("\n};", start);
  if (start === -1 || end === -1) throw new Error("CONTENT_PROP_FIELDS block not found");
  return src.slice(start, end + 3);
}

const DESIGN = defaultFunnelDesign;

function node(extra: Record<string, unknown> = {}): LeadgenComponentNode {
  return {
    type: "NameFieldsGroup",
    question_id: "q_name",
    props: {},
    ...extra,
  } as unknown as LeadgenComponentNode;
}
function render(extra: Record<string, unknown> = {}): string {
  return renderComponent(node(extra), DESIGN);
}

// ---------------------------------------------------------------------------
// PC-A8 — renderer matrix (presets.ts renderNameFieldsGroup)
// ---------------------------------------------------------------------------

describe("PC-A8 — NameFieldsGroup per-field placeholder", () => {
  it("firstPlaceholder/lastPlaceholder render as the input's placeholder attribute, independently", () => {
    const html = render({ props: { firstPlaceholder: "Jane", lastPlaceholder: "Doe" } });
    expect(html).toContain('data-name-field="first"');
    expect(html).toContain('data-name-field="last"');
    expect(html).toMatch(/data-name-field="first"[^>]*placeholder="Jane"/);
    expect(html).toMatch(/data-name-field="last"[^>]*placeholder="Doe"/);
  });
  it("byte-additive: no placeholder attribute at all when unauthored", () => {
    const html = render();
    expect(html).not.toContain("placeholder=");
  });
});

describe("PC-A8 — NameFieldsGroup per-field helper (+ the deprecated group-level fallback)", () => {
  it("firstHelper renders under the First field only; lastHelper is absent", () => {
    const html = render({ props: { firstHelper: "As shown on your card" } });
    expect(html).toContain("lg-field-help");
    expect(html).toContain("As shown on your card");
    // exactly ONE helper line (the group-level fallback must NOT ALSO render
    // once a per-field helper is authored)
    expect(html.match(/lg-field-help/g)?.length).toBe(1);
  });
  it("both firstHelper and lastHelper render, independently, two distinct lines", () => {
    const html = render({ props: { firstHelper: "First helper", lastHelper: "Last helper" } });
    expect(html).toContain("First helper");
    expect(html).toContain("Last helper");
    expect(html.match(/lg-field-help/g)?.length).toBe(2);
  });
  it("the OLD group-level `helper` still renders (legacy content) when NEITHER field has its own helper", () => {
    const html = render({ props: { helper: "Legacy shared helper" } });
    expect(html).toContain("lg-field-help");
    expect(html).toContain("Legacy shared helper");
    expect(html.match(/lg-field-help/g)?.length).toBe(1);
  });
  it("adopting a per-field helper DROPS the legacy group-level helper (no doubled copy)", () => {
    const html = render({ props: { helper: "Legacy shared helper", firstHelper: "New first helper" } });
    expect(html).toContain("New first helper");
    expect(html).not.toContain("Legacy shared helper");
    expect(html.match(/lg-field-help/g)?.length).toBe(1);
  });
  it("byte-additive: no helper markup at all when nothing is authored", () => {
    expect(render()).not.toContain("lg-field-help");
  });
});

describe("PC-A8 — NameFieldsGroup per-field leading icon", () => {
  it("firstIcon paints a leading icon on the First field only", () => {
    const html = render({ props: { firstIcon: "user" } });
    expect(html).toContain("lg-field-icon");
    expect(html.match(/lg-field-icon/g)?.length).toBe(1);
    expect(html).toContain('width="20" height="20"');
  });
  it("lastIcon paints a leading icon on the Last field only", () => {
    const html = render({ props: { lastIcon: "user" } });
    expect(html).toContain("lg-field-icon");
    expect(html.match(/lg-field-icon/g)?.length).toBe(1);
  });
  it("both firstIcon and lastIcon paint independently — two icon spans", () => {
    const html = render({ props: { firstIcon: "user", lastIcon: "calendar" } });
    expect(html.match(/lg-field-icon/g)?.length).toBe(2);
  });
  it("byte-additive: no icon markup at all when unauthored", () => {
    expect(render()).not.toContain("lg-field-icon");
  });
  it("an unauthored / 'none' icon id renders nothing for that field (mirrors fieldLeadingIcon's own convention)", () => {
    expect(render({ props: { firstIcon: "none" } })).not.toContain("lg-field-icon");
  });
});

describe("PC-A8 — firstLabel/lastLabel + required stay byte-identical (P4b's auto error slots + group-required)", () => {
  it("firstLabel/lastLabel still render (unaffected by the per-field additions)", () => {
    const html = render({ props: { firstLabel: "Given name", lastLabel: "Family name" } });
    expect(html).toContain("Given name");
    expect(html).toContain("Family name");
  });
  it("required still marks both native inputs", () => {
    const html = render({ required: true });
    expect(html.match(/ required/g)?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PC-A8 — content-schema.ts validation matrix
// ---------------------------------------------------------------------------

function sectionWith(props: Record<string, unknown>): unknown {
  return { components: [{ type: "NameFieldsGroup", question_id: "q_name", props }] };
}

describe("PC-A8 — content-schema validation: firstHelper/lastHelper (plain strings, valid on any node — mirrors `helper`)", () => {
  it("string values pass", () => {
    const r = validateSectionContent(sectionWith({ firstHelper: "a", lastHelper: "b" }));
    expect(r.errors).toEqual([]);
  });
  it("a non-string value is rejected with invalid_field_prop", () => {
    const r = validateSectionContent(sectionWith({ firstHelper: 123 }));
    expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.path.endsWith("firstHelper"))).toBe(true);
  });
});

describe("PC-A8 — content-schema validation: firstIcon/lastIcon (NameFieldsGroup-only, strict §8.5b enum)", () => {
  it("a real enum value on NameFieldsGroup passes", () => {
    const r = validateSectionContent(sectionWith({ firstIcon: "user", lastIcon: "calendar" }));
    expect(r.errors).toEqual([]);
  });
  it("a garbage string is rejected", () => {
    const r = validateSectionContent(sectionWith({ firstIcon: "not-a-real-icon" }));
    expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.path.endsWith("firstIcon"))).toBe(true);
  });
  it("firstIcon/lastIcon on any OTHER type is rejected (type-gated, mirrors role/TextBlock + source/ImageBlock)", () => {
    const r = validateSectionContent({
      components: [{ type: "FreeTextQuestion", question_id: "q", internal_field: "f", props: { firstIcon: "user" } }],
    });
    expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.message.includes("only valid on NameFieldsGroup"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PC-A8 — registry.ts doc-row truth
// ---------------------------------------------------------------------------

describe("PC-A8 — registry.ts NameFieldsGroup props doc row names the 6 new per-field keys", () => {
  it("props lists firstPlaceholder/lastPlaceholder/firstHelper/lastHelper/firstIcon/lastIcon", () => {
    const props = COMPONENT_CATALOG.NameFieldsGroup.props;
    for (const key of ["firstPlaceholder", "lastPlaceholder", "firstHelper", "lastHelper", "firstIcon", "lastIcon"]) {
      expect(props, `registry.ts props should list ${key}`).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// PC-A8 — Studio: the dedicated Basics block (server-rendered HTML) +
// CONTENT_PROP_FIELDS/hasContent structural truth (client island source)
// ---------------------------------------------------------------------------

describe("PC-A8 — the Studio's dedicated NameFieldsGroup Basics block ships both sub-groups", () => {
  const html = renderStudioInspector(DESIGN as unknown as FunnelDesign, null);
  it("carries the data-content-namefieldsgroup-block wrapper and both eyebrows", () => {
    expect(html).toContain("data-content-namefieldsgroup-block");
    expect(html).toContain("First name field");
    expect(html).toContain("Last name field");
  });
  it("carries all 8 per-field controls (label/placeholder/helper/icon x2)", () => {
    for (const key of ["firstLabel", "lastLabel", "firstPlaceholder", "lastPlaceholder", "firstHelper", "lastHelper", "firstIcon", "lastIcon"]) {
      expect(html, `data-inspector-field="${key}" present`).toContain(`data-inspector-field="${key}"`);
    }
  });
  it("the generic per-type copy-fields projection no longer carries a firstLabel/lastLabel row (moved into the dedicated block — no orphaned duplicate control)", () => {
    expect(html).not.toContain('data-content-prop="firstLabel"');
    expect(html).not.toContain('data-content-prop="lastLabel"');
  });
});

describe("PC-A8 — CONTENT_PROP_FIELDS.NameFieldsGroup is EMPTY (dedicated block supersedes the generic projection)", () => {
  it("NameFieldsGroup: [] in source (the ImageBlock precedent) — derived from the real committed file, not re-typed", () => {
    expect(contentPropFieldsSource()).toMatch(/NameFieldsGroup:\s*\[\],/);
  });
  it("availableTabsFor's hasContent carve-out names NameFieldsGroup AND QuestionGrid (else the Content tab itself would hide for them, exactly the ImageBlock bug this mirrors — R2 P1 §① gave QuestionGrid the identical empty-CONTENT_PROP_FIELDS/dedicated-block shape)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain(
      "node.type === 'ImageBlock' || node.type === 'NameFieldsGroup' || node.type === 'QuestionGrid' || FRAME_SCOPE_STUDIO_TYPES[node.type] === 1",
    );
  });
});

// ---------------------------------------------------------------------------
// PC-A10 — TextBlock icon control gated to its 2 consuming roles
// ---------------------------------------------------------------------------

describe("PC-A10 — the Studio hides TextBlock's generic Icon row for the 5 non-consuming roles", () => {
  it("the island's populateInspector gate names exactly reassurance/secure_badge as the consuming roles", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain(
      "var textBlockIconInert = !!node && node.type === 'TextBlock' && k === 'icon' && role !== 'reassurance' && role !== 'secure_badge';",
    );
  });
  it("presets.ts renderTextBlock: exactly reassurance/secure_badge read props.icon — grounds the gate above in the REAL renderer, not an assumption", () => {
    for (const role of ["heading", "body", "category_label", "helper", "legal"]) {
      const html = renderComponent(
        { type: "TextBlock", question_id: "q", props: { role, text: "x", icon: "🔥" } } as unknown as LeadgenComponentNode,
        DESIGN,
      );
      expect(html, `role=${role} must never render the authored icon glyph`).not.toContain("🔥");
    }
    for (const role of ["reassurance", "secure_badge"]) {
      const html = renderComponent(
        { type: "TextBlock", question_id: "q", props: { role, text: "x", icon: "🔥" } } as unknown as LeadgenComponentNode,
        DESIGN,
      );
      expect(html, `role=${role} must render the authored icon glyph`).toContain("🔥");
    }
  });
});

// ---------------------------------------------------------------------------
// PC-A10 — registry.ts DateQuestion "date range" claim (verified, unchanged)
// ---------------------------------------------------------------------------

describe("PC-A10 — DateQuestion registry claim 'date range' — verified TRUE post-P4b, no change needed", () => {
  it("the runtime validator enforces BOTH a min and a max bound (a real two-sided range, not a one-sided check)", () => {
    expect(COMPONENT_CATALOG.DateQuestion.validation).toContain("date range");
  });
});
