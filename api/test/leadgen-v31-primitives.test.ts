// LeadGen v3.1 Section Builder & Themes (design-locked contract) — Phase A
// slice A2. Proves: (1) TextBlock renders, per `role`, markup BYTE-EQUAL to
// its retired one-off preset's own output for an equivalent node — modulo
// the hydration() `data-component-type` attribute, which correctly differs
// (it names the node's REAL type and has zero CSS/JS consumers, grep-
// verified) — never a fidelity gap; (2) ImageBlock's auto_logo source
// resolves the identical logo-resolution fragment renderHeaderLogo uses;
// (3) the retired-type -> primitive mapping utils (primitiveViewOfNode /
// rewriteRetiredNodeToPrimitive) are pure, additive, and round-trip through
// validateSectionContent + renderComponent unchanged in visible output.
//
// §5.3 "existing sections... render byte-identically until edited" is
// covered by NOT touching the retired renderers at all (this suite proves
// the NEW functions match them — it never asserts the OLD ones changed).

import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  primitiveViewOfNode,
  rewriteRetiredNodeToPrimitive,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

// The ONLY intentional difference between a retired preset's output and its
// TextBlock-role equivalent is hydration()'s data-component-type VALUE (it
// correctly names the real type). Normalize it away before the byte-equal
// comparison; both sides' actual data-component-type value is asserted
// separately so the normalization can never hide a real divergence.
function normalizeComponentType(html: string): string {
  return html.replace(/data-component-type="[^"]*"/, 'data-component-type="TYPE"');
}

function afterMarker(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  expect(idx, `marker ${JSON.stringify(marker)} present in ${html}`).toBeGreaterThanOrEqual(0);
  return html.slice(idx + marker.length);
}

describe("v3.1 §5.3 — TextBlock role rendering is byte-equal to the retired preset it replaces", () => {
  it("role=category_label matches renderCategoryLabel's CategoryLabel output", () => {
    const retired: LeadgenComponentNode = {
      type: "CategoryLabel",
      question_id: "q1",
      props: { text: "BUSINESS LOAN" },
    };
    const primitive: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: "q1",
      props: { role: "category_label", text: "BUSINESS LOAN" },
    };
    const retiredHtml = renderComponent(retired, DESIGN);
    const primitiveHtml = renderComponent(primitive, DESIGN);
    expect(retiredHtml).toContain('data-component-type="CategoryLabel"');
    expect(primitiveHtml).toContain('data-component-type="TextBlock"');
    expect(normalizeComponentType(primitiveHtml)).toBe(normalizeComponentType(retiredHtml));
  });

  it("role=helper matches renderHelperText's HelperText output", () => {
    const retired: LeadgenComponentNode = {
      type: "HelperText",
      question_id: "q2",
      props: { text: "We never share this." },
    };
    const primitive: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: "q2",
      props: { role: "helper", text: "We never share this." },
    };
    expect(normalizeComponentType(renderComponent(primitive, DESIGN))).toBe(
      normalizeComponentType(renderComponent(retired, DESIGN)),
    );
  });

  it("role=legal matches renderLegalNote's LegalNote output (props.text <-> legacy props.html, same value)", () => {
    const retired: LeadgenComponentNode = {
      type: "LegalNote",
      question_id: "q3",
      props: { html: "Terms apply. Rates vary by state." },
    };
    const primitive: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: "q3",
      props: { role: "legal", text: "Terms apply. Rates vary by state." },
    };
    expect(normalizeComponentType(renderComponent(primitive, DESIGN))).toBe(
      normalizeComponentType(renderComponent(retired, DESIGN)),
    );
  });

  it("role=reassurance matches renderReassuranceBadge, including a custom icon glyph", () => {
    const retired: LeadgenComponentNode = {
      type: "ReassuranceBadge",
      question_id: "q4",
      props: { text: "Get your offers in 2 minutes or less.", icon: "⚡" },
    };
    const primitive: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: "q4",
      props: { role: "reassurance", text: "Get your offers in 2 minutes or less.", icon: "⚡" },
    };
    expect(normalizeComponentType(renderComponent(primitive, DESIGN))).toBe(
      normalizeComponentType(renderComponent(retired, DESIGN)),
    );
  });

  it("role=reassurance with NO icon authored falls back identically (default glyph)", () => {
    const retired: LeadgenComponentNode = { type: "ReassuranceBadge", question_id: "q4b", props: {} };
    const primitive: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: "q4b",
      props: { role: "reassurance" },
    };
    expect(normalizeComponentType(renderComponent(primitive, DESIGN))).toBe(
      normalizeComponentType(renderComponent(retired, DESIGN)),
    );
  });

  it("role=secure_badge matches renderSecureFormBadge", () => {
    const retired: LeadgenComponentNode = {
      type: "SecureFormBadge",
      question_id: "q5",
      props: { text: "256-bit SSL encrypted" },
    };
    const primitive: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: "q5",
      props: { role: "secure_badge", text: "256-bit SSL encrypted" },
    };
    expect(normalizeComponentType(renderComponent(primitive, DESIGN))).toBe(
      normalizeComponentType(renderComponent(retired, DESIGN)),
    );
  });

  // Heading/Body are NEW roles (no retired one-off precedent, §5.3) — smoke
  // test only: safe, escaped, hydrated, no <style>/<script>.
  it.each(["heading", "body"] as const)("role=%s renders safe token-styled markup (no retired precedent)", (role) => {
    const node: LeadgenComponentNode = {
      type: "TextBlock",
      question_id: `q_${role}`,
      props: { role, text: `<script>alert(1)</script> hostile & "quoted"` },
    };
    const html = renderComponent(node, DESIGN);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain(`data-component-type="TextBlock"`);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toMatch(/<style/);
  });

  it("an absent role defaults to heading (every TextBlock prop is optional)", () => {
    const node: LeadgenComponentNode = { type: "TextBlock", question_id: "q_default", props: { text: "Hi" } };
    const html = renderComponent(node, DESIGN);
    expect(html).toContain("lg-text-heading");
  });
});

describe("v3.1 §5.3 — ImageBlock source=auto_logo matches the existing auto-site-logo resolution", () => {
  it("with NO logoUrl, the text+accent fallback fragment is byte-identical to renderHeaderLogo's", () => {
    const header: LeadgenComponentNode = {
      type: "HeaderLogo",
      question_id: "q1",
      props: { siteName: "Acme", accent: "Quotes" },
    };
    const imageBlock: LeadgenComponentNode = {
      type: "ImageBlock",
      question_id: "q1",
      props: { source: "auto_logo", siteName: "Acme", accent: "Quotes" },
    };
    const headerHtml = renderComponent(header, DESIGN);
    const imageHtml = renderComponent(imageBlock, DESIGN);
    const headerInner = afterMarker(headerHtml, '<div class="lg-header-inner">').replace(/<\/div><\/header>$/, "");
    const imageInner = afterMarker(imageHtml, 'data-source="auto_logo">').replace(/<\/div>$/, "");
    expect(headerInner).toContain('<span class="lg-logo"');
    expect(imageInner).toBe(headerInner);
  });

  it("with a logoUrl set, the <img> fragment is byte-identical to renderHeaderLogo's", () => {
    const header: LeadgenComponentNode = {
      type: "HeaderLogo",
      question_id: "q2",
      props: { logoUrl: "https://cdn.example.com/logo.png", siteName: "Acme" },
    };
    const imageBlock: LeadgenComponentNode = {
      type: "ImageBlock",
      question_id: "q2",
      props: { source: "auto_logo", logoUrl: "https://cdn.example.com/logo.png", siteName: "Acme" },
    };
    const headerHtml = renderComponent(header, DESIGN);
    const imageHtml = renderComponent(imageBlock, DESIGN);
    const headerInner = afterMarker(headerHtml, '<div class="lg-header-inner">').replace(/<\/div><\/header>$/, "");
    const imageInner = afterMarker(imageHtml, 'data-source="auto_logo">').replace(/<\/div>$/, "");
    expect(headerInner).toContain('<img class="lg-logo-img"');
    expect(imageInner).toBe(headerInner);
  });

  it("does NOT reproduce the <header> landmark tag (unit-scope primitive, not a frame chrome element)", () => {
    const imageBlock: LeadgenComponentNode = {
      type: "ImageBlock",
      question_id: "q3",
      props: { source: "auto_logo", siteName: "Acme" },
    };
    expect(renderComponent(imageBlock, DESIGN)).not.toContain("<header");
  });

  it("source=media renders a plain img from logoMediaId (no retired-type precedent to match)", () => {
    const node: LeadgenComponentNode = {
      type: "ImageBlock",
      question_id: "q4",
      props: { source: "media", logoMediaId: "media_123", alt: "Acme logo" },
    };
    const html = renderComponent(node, DESIGN);
    expect(html).toContain('data-source="media"');
    expect(html).toContain('src="/media/media_123"'); // /media/ prefix: see leadgen-card-image-media-url
    expect(html).toContain('alt="Acme logo"');
  });

  it("source=media with no logoMediaId renders an empty (but valid, hydrated) shell", () => {
    const node: LeadgenComponentNode = { type: "ImageBlock", question_id: "q5", props: { source: "media" } };
    const html = renderComponent(node, DESIGN);
    expect(html).toContain('data-source="media"');
    expect(html).not.toContain("<img");
  });
});

describe("v3.1 §5.3 — retired-type -> primitive mapping utils", () => {
  it("primitiveViewOfNode maps every retired type to its primitive+role/source", () => {
    expect(primitiveViewOfNode({ type: "CategoryLabel", question_id: "q" })).toEqual({
      type: "TextBlock",
      role: "category_label",
    });
    expect(primitiveViewOfNode({ type: "HelperText", question_id: "q" })).toEqual({
      type: "TextBlock",
      role: "helper",
    });
    expect(primitiveViewOfNode({ type: "LegalNote", question_id: "q" })).toEqual({
      type: "TextBlock",
      role: "legal",
    });
    expect(primitiveViewOfNode({ type: "ReassuranceBadge", question_id: "q" })).toEqual({
      type: "TextBlock",
      role: "reassurance",
    });
    expect(primitiveViewOfNode({ type: "SecureFormBadge", question_id: "q" })).toEqual({
      type: "TextBlock",
      role: "secure_badge",
    });
    expect(primitiveViewOfNode({ type: "LogoStrip", question_id: "q" })).toEqual({
      type: "ImageBlock",
      source: "auto_logo",
    });
  });

  it("returns null for non-retired types, INCLUDING the new primitives themselves and the bound-headline/SuccessState exclusions", () => {
    for (const type of [
      "FreeTextQuestion",
      "TextBlock",
      "ImageBlock",
      "QuestionHeadline",
      "Subheadline",
      "SuccessState",
      "ContinueButton",
    ] as const) {
      expect(primitiveViewOfNode({ type, question_id: "q" }), type).toBeNull();
    }
  });

  it("rewriteRetiredNodeToPrimitive passes a non-retired node through UNCHANGED (same reference)", () => {
    const node: LeadgenComponentNode = { type: "FreeTextQuestion", question_id: "q", internal_field: "note" };
    expect(rewriteRetiredNodeToPrimitive(node)).toBe(node);
  });

  it("rewrites CategoryLabel -> TextBlock(role=category_label), preserving question_id + text; the rewrite validates", () => {
    const original: LeadgenComponentNode = {
      type: "CategoryLabel",
      question_id: "q_cat",
      props: { text: "AUTO INSURANCE" },
    };
    const rewritten = rewriteRetiredNodeToPrimitive(original);
    expect(rewritten.type).toBe("TextBlock");
    expect(rewritten.question_id).toBe("q_cat");
    expect(rewritten.props).toEqual({ role: "category_label", text: "AUTO INSURANCE" });
    expect(validateSectionContent({ components: [rewritten] }).errors).toEqual([]);
  });

  it("rewrites LegalNote's props.html into the new node's props.text (role=legal)", () => {
    const original: LeadgenComponentNode = {
      type: "LegalNote",
      question_id: "q_legal",
      props: { html: "Rates vary by state." },
    };
    const rewritten = rewriteRetiredNodeToPrimitive(original);
    expect(rewritten.type).toBe("TextBlock");
    expect(rewritten.props).toEqual({ role: "legal", text: "Rates vary by state." });
    expect(validateSectionContent({ components: [rewritten] }).errors).toEqual([]);
  });

  it("rewrites ReassuranceBadge, preserving its glyph icon (the badge-role validation carve-out)", () => {
    const original: LeadgenComponentNode = {
      type: "ReassuranceBadge",
      question_id: "q_rb",
      props: { text: "Fast quotes", icon: "⚡" },
    };
    const rewritten = rewriteRetiredNodeToPrimitive(original);
    expect(rewritten.props).toEqual({ role: "reassurance", text: "Fast quotes", icon: "⚡" });
    expect(validateSectionContent({ components: [rewritten] }).errors).toEqual([]);
  });

  it("rewrites LogoStrip -> ImageBlock(source=auto_logo)", () => {
    const original: LeadgenComponentNode = {
      type: "LogoStrip",
      question_id: "q_logo",
      props: { logos: [{ mediaId: "m1", alt: "Acme" }] },
    };
    const rewritten = rewriteRetiredNodeToPrimitive(original);
    expect(rewritten.type).toBe("ImageBlock");
    expect(rewritten.props).toEqual({ source: "auto_logo" });
    expect(validateSectionContent({ components: [rewritten] }).errors).toEqual([]);
  });

  it("preserves node-level fields untouched by the rewrite (design_overrides, conditional)", () => {
    const original: LeadgenComponentNode = {
      type: "HelperText",
      question_id: "q_helper",
      props: { text: "hint" },
      conditional: { when: "some_field", op: "eq", value: true },
      design_overrides: { columns: 3 },
    };
    const rewritten = rewriteRetiredNodeToPrimitive(original);
    expect(rewritten.conditional).toEqual(original.conditional);
    expect(rewritten.design_overrides).toEqual(original.design_overrides);
  });

  it("end-to-end: render(original retired node) content-equals render(rewritten primitive) — the migration is a no-op visually", () => {
    const original: LeadgenComponentNode = {
      type: "SecureFormBadge",
      question_id: "q_e2e",
      props: { text: "Bank-level encryption" },
    };
    const rewritten = rewriteRetiredNodeToPrimitive(original);
    expect(normalizeComponentType(renderComponent(rewritten, DESIGN))).toBe(
      normalizeComponentType(renderComponent(original, DESIGN)),
    );
  });
});

// ---------------------------------------------------------------------------
// v3.1 §7/§12 — conductor fix round: resolveFieldSize WIRED into the actual
// field rendering path (presets.ts), so an authored design_overrides.size is
// actually visible in rendered output, not just resolved as data.
//
// Adversarial-review correction (§0.1): the FIRST cut of this coverage
// asserted a fabricated preset->px table (s/m/l width, small/medium/large
// height — none of it golden/contract-sourced). Re-derived from the golden
// master VERBATIM (docs/leadgen/redesign-contract-v3/golden/
// golden-master-source.dc.html — search fieldWrapStyle/fieldBoxStyle):
// fieldBoxStyle NEVER carries an explicit height (either hMode branch —
// 'padding:16px 18px' only); fieldWrapStyle is 'width:100%' for EVERY
// non-custom wMode and 'width:64%' (the DISCLAIMED faked-drag demo value)
// for custom. So the ONLY two grounded resolutions are: width="full" -> 100%
// (byte-identical to the golden's non-custom fieldWrapStyle; also Appendix
// B's "Unit column width: 600" = 100% of the column), and EITHER axis's
// {custom_px} -> the literal stored number (never a lookup — grounded by
// construction, §7.2 "custom_px = manual override"). Width s/m/l and EVERY
// height preset (small/medium/large) are a recorded CONTRACT GAP — asserted
// here as "renders NO explicit dimension for that axis," never a number.
// ---------------------------------------------------------------------------

describe("v3.1 §7/§12 — field size APPLICATION is wired into rendered HTML (grounded cases only)", () => {
  it("absent design_overrides.size renders WITHOUT any width/height inline style (byte-identical regression proof — the overwhelming majority of existing content)", () => {
    const node: LeadgenComponentNode = { type: "ZIPInputQuestion", question_id: "q1", internal_field: "zip" };
    const html = renderComponent(node, DESIGN);
    expect(html).not.toMatch(/style="[^"]*width/);
    expect(html).not.toMatch(/style="[^"]*height/);
  });

  // R3 fix-round grounding erratum (register): the node's explicit
  // height:"medium" now resolves too (52px, the §10.4 "shared size language"
  // theme default) — pinned instead of asserted absent.
  it("width 'full' renders width:100% — GROUNDED, byte-identical to the golden's non-custom fieldWrapStyle — height:medium renders its grounded 52px", () => {
    const node: LeadgenComponentNode = {
      type: "ZIPInputQuestion",
      question_id: "q2",
      internal_field: "zip",
      design_overrides: { size: { width: "full", height: "medium" } },
    };
    const html = renderComponent(node, DESIGN);
    expect(html).toContain("width:100%");
    expect(html).toContain("height:52px");
  });

  it("width absent -> inherits the design default 'full' -> ALSO renders width:100% (the resolver's own absent-width fallback, not a new special case)", () => {
    const node: LeadgenComponentNode = {
      type: "ZIPInputQuestion",
      question_id: "q2b",
      internal_field: "zip",
      design_overrides: { size: { height: "small" } }, // width key absent entirely
    };
    expect(renderComponent(node, DESIGN)).toContain("width:100%");
  });

  // R3 fix-round grounding erratum (register): width s/m/l now resolve to
  // GROUNDED px — m=384px is contract §7.1's own "384 (= 64% of the 600
  // column)"; s/l=300/480px are the proposed-errata 50%/80% brackets.
  it("width s/m/l tiers render their grounded px (R3 fix-round erratum: 300/384/480px)", () => {
    const WIDTH_PX: Record<string, string> = { s: "300px", m: "384px", l: "480px" };
    for (const width of ["s", "m", "l"] as const) {
      const node: LeadgenComponentNode = {
        type: "ZIPInputQuestion",
        question_id: `q3-${width}`,
        internal_field: "zip",
        design_overrides: { size: { width } },
      };
      expect(renderComponent(node, DESIGN), width).toContain(`width:${WIDTH_PX[width]}`);
    }
  });

  // R3 fix-round grounding erratum (register): height small/medium/large now
  // resolve to the §10.4 "shared size language" control heights (44/52/60px
  // — base .lg-input min-height + theme Button-size M/L). The size override
  // is now genuinely ABSENT (matching this test's OWN pre-existing comment,
  // which the original code contradicted by setting an explicit "medium"),
  // so each iteration actually exercises theme_controls.field_height's
  // per-value fallback instead of a constant explicit override.
  it("EVERY height preset (small/medium/large) renders its grounded height when the axis is ABSENT and inherits theme_controls.field_height (44/52/60px)", () => {
    const HEIGHT_PX: Record<string, string> = { small: "44px", medium: "52px", large: "60px" };
    for (const field_height of ["small", "medium", "large"] as const) {
      const node: LeadgenComponentNode = {
        type: "ZIPInputQuestion",
        question_id: `q4-${field_height}`,
        internal_field: "zip",
        design_overrides: { size: {} }, // height key ABSENT -> inherits theme_controls.field_height
      };
      const html = renderSectionComponents([node], DESIGN, {
        headline_text: "",
        subheadline_text: null,
        theme_controls: { field_height, button_size: "m", corners: "rounded" },
      });
      expect(html, field_height).toContain(`height:${HEIGHT_PX[field_height]}`);
    }
  });

  it("{custom_px} rides as an EXPLICIT, literal px value on BOTH axes (§12 'custom_px -> explicit px') — grounded because it is the stored number, never a lookup", () => {
    const node: LeadgenComponentNode = {
      type: "ZIPInputQuestion",
      question_id: "q5",
      internal_field: "zip",
      design_overrides: { size: { width: { custom_px: 384 }, height: { custom_px: 56 } } },
    };
    const html = renderSectionComponents([node], DESIGN, {
      headline_text: "",
      subheadline_text: null,
      theme_controls: { field_height: "large", button_size: "m", corners: "rounded" },
    });
    // The exact byte shape A3's HTTP parity test asserts for custom_px:384.
    expect(html).toContain("width:384px");
    expect(html).toContain("height:56px");
  });

  it("applies to the CurrencyInputQuestion + AddressAutocompleteQuestion wrapper divs too (not just the shared renderTextInput helper) — custom_px only, since preset tiers are ungrounded", () => {
    const currency: LeadgenComponentNode = {
      type: "CurrencyInputQuestion",
      question_id: "q6",
      internal_field: "income",
      design_overrides: { size: { width: { custom_px: 300 } } },
    };
    const address: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q7",
      design_overrides: { size: { width: "full" } },
    };
    expect(renderComponent(currency, DESIGN)).toContain("width:300px");
    expect(renderComponent(address, DESIGN)).toContain("width:100%");
  });

  it("does NOT apply to NameFieldsGroup (two labeled sub-inputs, not one field box — intentionally unwired, see presets.ts comment)", () => {
    const node: LeadgenComponentNode = {
      type: "NameFieldsGroup",
      question_id: "q8",
      design_overrides: { size: { width: "full" } },
    };
    expect(renderComponent(node, DESIGN)).not.toMatch(/style="[^"]*width/);
  });

  it("an out-of-range custom_px is defensively re-clamped at RENDER time too (belt-and-suspenders over save-time validation) — the [200,600] bound is contract-explicit (§7.1), not invented", () => {
    const tooWide: LeadgenComponentNode = {
      type: "FreeTextQuestion",
      question_id: "q9",
      internal_field: "note",
      design_overrides: { size: { width: { custom_px: 9999 } } },
    };
    expect(renderComponent(tooWide, DESIGN)).toContain("width:600px");
  });
});
