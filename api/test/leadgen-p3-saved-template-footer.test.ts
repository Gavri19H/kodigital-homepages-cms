// R2 P3 BLOCKER round — "a saved template alone is a frame".
//
// FAIL-BEFORE (captured live, docs/leadgen/r2/evidence/p3/blocker-fail-before
// .txt): a funnel with frame_template_id set and frame_config_json NULL — the
// state "apply template" leaves behind — served HTTP 200 with
// hasFrame=false / hasFooterRegion=false and ZERO hits of the authored footer
// copy; forcing that same sparse saved template into frame_config_json served
// HTTP 500. Both legs are pinned below at the unit boundary, and the fixes are:
//   1. resolver.ts resolveEffectiveFrameOnly — compose from
//      saved_template_defaults when the frame column is TRULY ABSENT.
//   2. serve.ts resolveFrameComposition — the saved template is design intent
//      (like P2's inline theme) and, unlike a theme, is a REAL frame, so it is
//      used INSTEAD OF the synthetic narrow default.
//   3. frames.ts effectiveFrame — a saved row is a SPARSE PATCH over its own
//      recorded arrangement family's defaults, never a complete
//      EffectiveFrameConfig; cloning it left whole groups undefined (the 500).
//   4. quotes-handlers.ts — the Templates canvas composes from the same row.
//   5. resolver.ts composeResolvedBundle — the D2 picks lookup reads the same
//      composition the render does.
// Plus the three editor wirings element J needs to be authorable at all.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { effectiveFrame, FRAME_TEMPLATES, type EffectiveFrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveEffectiveFrameOnly, type ResolvedFunnelSection } from "../src/public/leadgen/resolver";
import { resolveFrameComposition, renderVariantSectionsHtml } from "../src/public/leadgen/serve";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";

const DESIGN = getFunnelDesign("default-funnel");

// The EXACT sparse shape the real Templates tab saves when the operator edits
// only element G (verified against the live drive's readback of
// GET /frame-template-records/:id — no `section_slot`, no `header`, no
// `show_on`; see docs/leadgen/r2/evidence/p3/drive-editor-authoring.txt).
const SPARSE_SAVED_TEMPLATE = {
  template: "centered",
  version: 1,
  footer: {
    enabled: true,
    palette_scope: { background: "card_background", text: "text_muted", link: "brand_primary" },
    typography_scope: { size: "s", font_family: "Inter" },
    blocks: [
      { type: "link_row", links_source: "manual", align: "center", links: [{ label: "Privacy Policy", href: "/privacy" }] },
      { type: "about_paragraph", align: "left", text: "P3Fix28 company details.", html: "P3Fix28 company details." },
    ],
  },
} as unknown as EffectiveFrameConfig;

function sectionsFixture(): ResolvedFunnelSection[] {
  return [
    {
      position: 0,
      section: {
        id: 1,
        public_id: "lgs_p3fix",
        headline_text: "Pick one",
        subheadline_text: null,
        continue_mode: "manual",
        content_json: "[]",
        design_overrides_json: null,
      },
    } as unknown as ResolvedFunnelSection,
  ];
}

function frameHtml(frame: EffectiveFrameConfig, sectionsHtml: string, tokens: unknown): string {
  return renderQuoteFrame({
    effectiveTokens: tokens,
    frame,
    siteBranding: null,
    sectionsHtml,
    bannersMountHtml: "",
    sectionCount: 1,
    root: { funnelId: "lgf_x", funnelVariantId: "lgn_x", quoteId: "lgq_x", contentVersion: 1 },
  } as unknown as Parameters<typeof renderQuoteFrame>[0]);
}

describe("R2 P3 blocker — a SAVED TEMPLATE alone composes a frame (contract §5.4 end state #6)", () => {
  it("FAIL-BEFORE leg 1: frame_config_json NULL + a saved template now composes a frame WITH the element-J footer", () => {
    const composition = resolveFrameComposition(
      { frame_config_json: null, theme_json: null, frame_overrides_json: null, saved_template_defaults: SPARSE_SAVED_TEMPLATE },
      DESIGN,
    );
    expect(composition, "a template-seeded funnel must compose a frame (it served frameless before)").not.toBeNull();
    expect(composition?.frame.footer.enabled).toBe(true);
    expect(composition?.frame.footer.blocks?.length).toBe(2);
    expect(composition?.frame.footer.typography_scope?.font_family).toBe("Inter");
  });

  it("FAIL-BEFORE leg 2: a SPARSE saved template yields a COMPLETE effective frame — the group reads that 500'd are all populated", () => {
    const { frame } = effectiveFrame(null, null, null, SPARSE_SAVED_TEMPLATE);
    // serve.ts renderVariantSectionsHtml reads these two unconditionally; they
    // were `undefined` before (TypeError -> 500 for the WHOLE public page).
    expect(frame.section_slot).toBeDefined();
    expect(frame.section_slot.continue_placement).toBe(
      FRAME_TEMPLATES["centered"].defaults.section_slot.continue_placement,
    );
    expect(frame.section_slot.continue_style_role).toBe(
      FRAME_TEMPLATES["centered"].defaults.section_slot.continue_style_role,
    );
    for (const group of ["header", "progress", "back", "disclosure", "trust_strip", "benefit_bar", "background", "mobile"] as const) {
      expect(frame[group], `frame.${group} must be composed, never undefined`).toBeDefined();
    }
    // and the authored footer still wins over the family default
    expect(frame.footer.blocks?.length).toBe(2);
    expect(frame.footer.show_on).toBe(FRAME_TEMPLATES["centered"].defaults.footer.show_on);
  });

  it("FAIL-BEFORE leg 2, end to end: the two renderers that threw now produce markup for a sparse saved template", () => {
    const composition = resolveFrameComposition(
      { frame_config_json: null, theme_json: null, frame_overrides_json: null, saved_template_defaults: SPARSE_SAVED_TEMPLATE },
      DESIGN,
    );
    expect(composition).not.toBeNull();
    const sectionsHtml = renderVariantSectionsHtml(sectionsFixture(), DESIGN, composition!.frame);
    expect(sectionsHtml).toContain("data-lg-section");
    const page = frameHtml(composition!.frame, sectionsHtml, composition!.effectiveTokens);
    expect(page).toContain('data-frame-region="footer"');
    expect(page).toContain("lg-frame-footer2");
    expect(page).toContain("P3Fix28 company details.");
    expect(page).toContain("--lg-footer-font:");
  });

  it("resolveEffectiveFrameOnly composes from the saved template when the frame column is absent", () => {
    const frame = resolveEffectiveFrameOnly({
      frame_config_json: null,
      theme_json: null,
      frame_overrides_json: null,
      saved_template_defaults: SPARSE_SAVED_TEMPLATE,
    });
    expect(frame).not.toBeNull();
    expect(frame?.footer.blocks?.length).toBe(2);
    expect(frame?.section_slot.card).toBe(FRAME_TEMPLATES["centered"].defaults.section_slot.card);
  });

  it("variant frame_overrides_json still layers OVER a saved template (merge order template ⊕ funnel ⊕ variant)", () => {
    const frame = resolveEffectiveFrameOnly({
      frame_config_json: null,
      theme_json: null,
      frame_overrides_json: JSON.stringify({ footer: { hide_on_mobile: true } }),
      saved_template_defaults: SPARSE_SAVED_TEMPLATE,
    });
    expect(frame?.footer.hide_on_mobile).toBe(true);
    expect(frame?.footer.blocks?.length).toBe(2); // the template's own blocks survive
  });

  it("R4-48 fail-safe PRESERVED: a present-but-corrupt frame_config_json stays frameless even WITH a saved template", () => {
    for (const corrupt of ["{not json", '"a string"', "[]"]) {
      expect(
        resolveFrameComposition(
          { frame_config_json: corrupt, theme_json: null, frame_overrides_json: null, saved_template_defaults: SPARSE_SAVED_TEMPLATE },
          DESIGN,
        ),
        `corrupt frame column ${corrupt} must take the legacy fail-safe path`,
      ).toBeNull();
      expect(
        resolveEffectiveFrameOnly({
          frame_config_json: corrupt,
          theme_json: null,
          frame_overrides_json: null,
          saved_template_defaults: SPARSE_SAVED_TEMPLATE,
        }),
      ).toBeNull();
    }
  });

  it("REGRESSION (P2): frameless + INLINE theme, no saved template, still composes the narrow-default minimal frame", () => {
    const composition = resolveFrameComposition(
      { frame_config_json: null, theme_json: JSON.stringify({ palette: { brand_primary: "#B5179E" } }), frame_overrides_json: null },
      DESIGN,
    );
    expect(composition).not.toBeNull();
    expect(composition?.frame.template).toBe("minimal");
    expect(composition?.frame.header.enabled).toBe(false);
  });

  it("REGRESSION: a saved template BEATS the synthetic narrow default when the funnel also carries an inline theme", () => {
    const composition = resolveFrameComposition(
      {
        frame_config_json: null,
        theme_json: JSON.stringify({ palette: { brand_primary: "#B5179E" } }),
        frame_overrides_json: null,
        saved_template_defaults: SPARSE_SAVED_TEMPLATE,
      },
      DESIGN,
    );
    expect(composition?.frame.template).toBe("centered"); // the template's family, not the fail-safe "minimal"
    expect(composition?.frame.footer.blocks?.length).toBe(2);
  });

  it("REGRESSION: a legacy funnel (absent frame + no theme + no template) is STILL frameless — byte-identical", () => {
    expect(
      resolveFrameComposition({ frame_config_json: null, theme_json: null, frame_overrides_json: null }, DESIGN),
    ).toBeNull();
    expect(
      resolveFrameComposition(
        { frame_config_json: null, theme_json: null, frame_overrides_json: null, saved_template_defaults: null },
        DESIGN,
      ),
    ).toBeNull();
  });

  it("REGRESSION: a COMPLETE saved template composes EXACTLY as before the fix (merge identity over its own family)", () => {
    // Pre-fix this branch was `frame = cloneJson(savedTemplateDefaults)`. For a
    // complete row the widened merge must be indistinguishable from that.
    for (const id of Object.keys(FRAME_TEMPLATES) as Array<keyof typeof FRAME_TEMPLATES>) {
      const complete = FRAME_TEMPLATES[id].defaults;
      const { frame } = effectiveFrame(null, null, null, complete);
      expect(frame, `complete saved template '${id}' must be merge-identical to a raw clone`).toEqual({
        ...(JSON.parse(JSON.stringify(complete)) as Record<string, unknown>),
        template: id,
        version: 1,
      });
    }
  });

  it("REGRESSION: a pre-J footer (the 6 ORIGINAL block types) renders identically via a saved template and via frame_config_json", () => {
    const preJFooter = {
      enabled: true,
      blocks: [
        { type: "about_paragraph", align: "left", text: "Company details." },
        { type: "link_row", links_source: "manual", align: "center", links: [{ label: "Terms", href: "/terms" }] },
        { type: "disclosure", align: "left", text: "Disclosure copy." },
        { type: "logo", align: "center" },
        { type: "address", align: "left", text: "1 Main St" },
        { type: "socials", align: "center", socials: [{ platform: "x", url: "https://x.com/p3fix" }] },
      ],
    };
    const viaConfig = resolveEffectiveFrameOnly({
      frame_config_json: JSON.stringify({ template: "centered", version: 1, footer: preJFooter }),
      theme_json: null,
      frame_overrides_json: null,
    });
    const viaTemplate = resolveEffectiveFrameOnly({
      frame_config_json: null,
      theme_json: null,
      frame_overrides_json: null,
      saved_template_defaults: { template: "centered", version: 1, footer: preJFooter } as unknown as EffectiveFrameConfig,
    });
    expect(viaConfig).not.toBeNull();
    expect(viaTemplate).toEqual(viaConfig);

    const tokens = resolveFrameComposition(
      { frame_config_json: JSON.stringify({ template: "centered", version: 1 }), theme_json: null, frame_overrides_json: null },
      DESIGN,
    )!.effectiveTokens;
    expect(frameHtml(viaTemplate!, "", tokens)).toBe(frameHtml(viaConfig!, "", tokens)); // byte-identical
  });
});

describe("R2 P3 blocker — the three editor wirings element J needs (SOURCE-OF-TRUTH A.2)", () => {
  const panel = renderTemplatesTabPanel(true, []);

  // R2 P7: the footer panel is now rendered LAST (owner ruling — it is element
  // J, a "seperate template element"), so slicing to a HARD-CODED next-panel id
  // ("images") produced an empty string and vacuously broke this check. The
  // slice is now order-independent: footer panel start → whichever
  // data-tplbox-panel comes next, or the end of the markup if it is last. The
  // assertion itself is unchanged and still scoped to the footer box alone.
  const footerStart = panel.indexOf('data-tplbox-panel="footer"');
  const nextPanel = panel.indexOf('data-tplbox-panel="', footerStart + 1);
  const footerBox = panel.slice(footerStart, nextPanel === -1 ? panel.length : nextPanel);

  it("UI gap 1: the footer box J exposes footer.enabled (the operator can turn the footer on)", () => {
    expect(footerStart, "the footer panel is rendered at all").toBeGreaterThan(-1);
    expect(footerBox.length, "the footer slice is non-empty (guards the vacuous-slice class)").toBeGreaterThan(500);
    expect(footerBox, "element J must carry the footer.enabled control").toContain('data-frame-key="footer.enabled"');
    expect(footerBox).toContain('type="checkbox"');
  });

  // The island is a plain-ES5 source string. This runs the REAL shipped
  // function (sliced verbatim out of QUOTE_EDITOR_SCRIPT, never re-typed) in a
  // node:vm sandbox against a minimal element stub. The behavioral drive of the
  // whole editor is docs/leadgen/r2/evidence/p3/drive-editor-authoring.txt.
  function loadFooterBlockTypeChanged(): (row: unknown) => void {
    const start = QUOTE_EDITOR_SCRIPT.indexOf("function footerBlockTypeChanged(blockRow) {");
    expect(start, "footerBlockTypeChanged must exist in the shipped island").toBeGreaterThan(-1);
    const end = QUOTE_EDITOR_SCRIPT.indexOf("\n  }", start) + 4;
    const src = QUOTE_EDITOR_SCRIPT.slice(start, end);
    return runInNewContext(`${src}; footerBlockTypeChanged;`, {}) as (row: unknown) => void;
  }

  interface StubEl {
    className: string;
    value?: string;
  }
  function stubRow(type: string): { row: unknown; els: Record<string, StubEl> } {
    const els: Record<string, StubEl> = {
      "[data-footer-block-type]": { className: "", value: type },
      "[data-footer-block-text]": { className: "form-input" },
      "[data-footer-block-linkrow]": { className: "lg-hidden" },
      "[data-footer-block-items]": { className: "form-input lg-hidden" },
      "[data-footer-block-liststyle]": { className: "form-select form-select-sm lg-hidden" },
      "[data-footer-block-logo]": { className: "lg-hidden" },
      "[data-footer-block-toolbar]": { className: "lg-tplbox-toolbar" },
    };
    return { row: { querySelector: (sel: string) => els[sel] ?? null }, els };
  }
  const shown = (el: StubEl): boolean => el.className.indexOf("lg-hidden") === -1;

  it("UI gap 2: footerBlockTypeChanged un-hides the right sub-fields for ALL EIGHT block types", () => {
    const fn = loadFooterBlockTypeChanged();
    const expected: Record<string, { text: boolean; links: boolean; list: boolean; logo: boolean; toolbar: boolean }> = {
      about_paragraph: { text: true, links: false, list: false, logo: false, toolbar: true },
      disclosure: { text: true, links: false, list: false, logo: false, toolbar: true },
      address: { text: true, links: false, list: false, logo: false, toolbar: false },
      heading: { text: true, links: false, list: false, logo: false, toolbar: true },
      list: { text: false, links: false, list: true, logo: false, toolbar: false },
      logo: { text: false, links: false, list: false, logo: true, toolbar: false },
      link_row: { text: false, links: true, list: false, logo: false, toolbar: false },
      socials: { text: false, links: false, list: false, logo: false, toolbar: false },
    };
    for (const [type, want] of Object.entries(expected)) {
      const { row, els } = stubRow(type);
      fn(row);
      expect(shown(els["[data-footer-block-text]"]!), `${type}: text area`).toBe(want.text);
      expect(shown(els["[data-footer-block-linkrow]"]!), `${type}: link row`).toBe(want.links);
      expect(shown(els["[data-footer-block-items]"]!), `${type}: list items`).toBe(want.list);
      expect(shown(els["[data-footer-block-liststyle]"]!), `${type}: list style`).toBe(want.list);
      expect(shown(els["[data-footer-block-logo]"]!), `${type}: logo box`).toBe(want.logo);
      expect(shown(els["[data-footer-block-toolbar]"]!), `${type}: rich toolbar`).toBe(want.toolbar);
    }
  });

  it("UI gap 3: the data-footer-fmt toolbar is wired, and resolves the button through closestAttr (its glyph is the click target)", () => {
    expect(QUOTE_EDITOR_SCRIPT, "the toolbar must have a handler at all").toContain("data-footer-fmt");
    expect(QUOTE_EDITOR_SCRIPT).toContain("closestAttr(el, 'data-footer-fmt')");
    // RECAPTURED (R2 P3 FIX-FIRST, MINOR-13): the pinned literal was
    // `wrapSelection(footerTa, footerFmt)`. wrapSelection now takes a third
    // `after` callback so the LINK case can run through the studio modal
    // instead of window.prompt() — the wrap is applied on Insert, never on
    // Cancel, so the persist call HAS to move inside that callback. Both
    // things this check asserts are unchanged and still asserted below: the
    // toolbar wraps the FOOTER textarea, and it persists through the FOOTER's
    // collector (never free_text's).
    const at = QUOTE_EDITOR_SCRIPT.indexOf("wrapSelection(footerTa, footerFmt,");
    expect(at, "the footer toolbar must wrap the FOOTER textarea").toBeGreaterThan(-1);
    expect(QUOTE_EDITOR_SCRIPT.slice(at, at + 120)).toContain("writeConfigValue('footer.blocks', collectFooterBlocks())");
  });

  it("UI gap 2 (write+read sides): the island's footer collector/filler carry every element-J field", () => {
    for (const token of [
      "block.html = text",
      "block.items = items",
      "block.list_style",
      "block.logo_source",
      "block.logo_media_id",
      "block.logo_url",
      "block.logo_alt",
      "block.picks = picks",
      "collectFooterPickRows",
      "addFooterPickRow",
    ]) {
      expect(QUOTE_EDITOR_SCRIPT, `the island must round-trip ${token}`).toContain(token);
    }
  });

  it("the island stays strict ES5 (no arrow/const/let/backtick) after these wirings", () => {
    expect(QUOTE_EDITOR_SCRIPT).not.toMatch(/=>/);
    expect(QUOTE_EDITOR_SCRIPT).not.toMatch(/\b(const|let)\s/);
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("`");
  });
});
