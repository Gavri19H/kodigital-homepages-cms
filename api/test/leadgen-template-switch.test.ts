// LeadGen v2.5 Phase B (slice B1) — contract test `template-switch-merge`
// (redesign-contract-v2.5 04 §4.3, C5): computeTemplateSwitch implements the
// per-GROUP three-way merge classes EXACTLY —
//
//   * operator content PRESERVED verbatim (copy, media, legal links,
//     palette-role picks, policy fields);
//   * layout/position REPLACED by the target template's defaults (dropped
//     from the sparse patch — effectiveFrame lets the target show through);
//   * region availability preserved-where-supported; unsupported-but-enabled
//     → confirmation naming exactly what stops rendering, availability falls
//     to the target default (data never deleted — the group stays inert and
//     revives on switch-back);
//   * confirmation triggers: (a) unsupported-enabled region, (b)
//     section_slot.card change (card ⇄ bare), (c) manual logo / background
//     image;
//   * PURE — preview-before-apply posts the merged result as
//     draft_frame_config; nothing persists and inputs are never mutated (C5;
//     the endpoint-level no-persist proof lives in
//     leadgen-preview-modes.test.ts).

import { describe, expect, it } from "vitest";
import {
  FRAME_TEMPLATES,
  TEMPLATE_REGION_SUPPORT,
  computeTemplateSwitch,
  effectiveFrame,
  validateFrameConfig,
} from "../src/public/leadgen/designs/frames";
import type { StoredFrameConfig } from "../src/public/leadgen/designs/frames";

// A content-rich stored config on `centered` exercising every merge class.
function richCenteredConfig(): StoredFrameConfig {
  return {
    version: 1,
    template: "centered",
    header: { tagline: "Trusted by thousands", logo_size: "l", logo_align: "left", sticky: false },
    progress: { style: "dots", position: "top", color_role: "accent" },
    back: { style: "button", position: "footer", label: "Go back" },
    disclosure: { enabled: true, location: "top_bar", text: "Ad disclosure copy." },
    footer: {
      enabled: true,
      description: "Legal description line",
      links_source: "manual",
      links: [{ label: "Privacy", href: "/privacy" }],
      trust_text: "As seen on TV",
    },
    trust_strip: {
      enabled: true,
      logos: [
        { media_id: "logos/a.png", alt: "A" },
        { media_id: "logos/b.png", alt: "B" },
      ],
      placement: "between_progress_and_unit",
    },
    benefit_bar: {
      enabled: true,
      items: [
        { icon: "star", text: "Fast" },
        { icon: "lock", text: "Secure" },
        { icon: "check", text: "Free" },
      ],
      placement: "bottom",
    },
    background: { role: "surface_wash", image_media_id: "bg/hero.png", style: "flat" },
    section_slot: { card: "card", max_width: "l", padding: "l" },
    mobile: { hide_footer: true },
    compat: { allow_section_chrome: true },
  };
}

describe("template-switch-merge (04 §4.3, C5)", () => {
  it("operator content is PRESERVED verbatim; layout/position is REPLACED by target defaults", () => {
    const current = richCenteredConfig();
    const { merged } = computeTemplateSwitch(current, "header-footer");
    expect(merged.template).toBe("header-footer");
    expect(merged.version).toBe(1);

    // Content class — verbatim.
    expect(merged.header?.tagline).toBe("Trusted by thousands");
    expect(merged.progress?.color_role).toBe("accent");
    expect(merged.back?.label).toBe("Go back");
    expect(merged.disclosure?.text).toBe("Ad disclosure copy.");
    expect(merged.footer?.description).toBe("Legal description line");
    expect(merged.footer?.links).toEqual([{ label: "Privacy", href: "/privacy" }]);
    expect(merged.footer?.links_source).toBe("manual");
    expect(merged.footer?.trust_text).toBe("As seen on TV");
    expect(merged.trust_strip?.logos).toHaveLength(2);
    expect(merged.benefit_bar?.items).toHaveLength(3);
    expect(merged.background?.role).toBe("surface_wash");
    expect(merged.background?.image_media_id).toBe("bg/hero.png");
    expect(merged.compat?.allow_section_chrome).toBe(true); // policy never flips silently

    // Layout/position class — dropped, so the target defaults apply.
    expect(merged.header?.logo_size).toBeUndefined();
    expect(merged.header?.logo_align).toBeUndefined();
    expect(merged.header?.sticky).toBeUndefined();
    expect(merged.progress?.style).toBeUndefined();
    expect(merged.progress?.position).toBeUndefined();
    expect(merged.back?.style).toBeUndefined();
    expect(merged.back?.position).toBeUndefined();
    expect(merged.disclosure?.location).toBeUndefined();
    expect(merged.trust_strip?.placement).toBeUndefined();
    expect(merged.benefit_bar?.placement).toBeUndefined();
    expect(merged.background?.style).toBeUndefined();
    expect(merged.section_slot).toBeUndefined(); // geometry-only group → empty → omitted
    expect(merged.mobile).toBeUndefined(); // sparse layout overrides replaced whole

    // The effective result shows the target's arrangement with the operator's
    // content riding it (ONE merge implementation — effectiveFrame, 13 §13.2).
    const { frame } = effectiveFrame(merged);
    expect(frame.template).toBe("header-footer");
    expect(frame.header.logo_align).toBe("left"); // header-footer's own default
    expect(frame.header.tagline).toBe("Trusted by thousands");
    expect(frame.section_slot.card).toBe("bare");
    expect(frame.progress.style).toBe("bar");
    expect(frame.footer.show_logo).toBe(true);
  });

  it("region availability: unsupported-but-enabled falls to the target default (inert, data kept); supported enables ride verbatim", () => {
    const current = richCenteredConfig();
    const { merged } = computeTemplateSwitch(current, "header-footer");

    // trust_strip + benefit_bar aren't part of 'header-footer' → the stored
    // enabled:true is dropped; the CONTENT stays (inert — never deleted).
    expect(TEMPLATE_REGION_SUPPORT["header-footer"].has("trust_strip")).toBe(false);
    expect(merged.trust_strip?.enabled).toBeUndefined();
    expect(merged.trust_strip?.logos).toHaveLength(2);
    expect(merged.benefit_bar?.enabled).toBeUndefined();
    expect(merged.benefit_bar?.items).toHaveLength(3);
    const { frame } = effectiveFrame(merged);
    expect(frame.trust_strip.enabled).toBe(false); // "won't show" is TRUE
    expect(frame.benefit_bar.enabled).toBe(false);

    // footer IS part of 'header-footer' → the operator's enabled rides.
    expect(merged.footer?.enabled).toBe(true);
    expect(frame.footer.enabled).toBe(true);

    // disclosure is a compliance affordance supported by every template.
    expect(merged.disclosure?.enabled).toBe(true);
    expect(frame.disclosure.enabled).toBe(true);
  });

  it("confirmation (a): an enabled region not part of the target names exactly what stops rendering", () => {
    // The contract's own example, verbatim: benefit bar with 3 items → centered.
    const current: StoredFrameConfig = {
      version: 1,
      template: "header-cta",
      benefit_bar: {
        enabled: true,
        items: [
          { icon: "star", text: "Fast" },
          { icon: "lock", text: "Secure" },
          { icon: "check", text: "Free" },
        ],
      },
    };
    const { confirmations } = computeTemplateSwitch(current, "centered");
    expect(confirmations).toContain(
      "Benefit bar isn't part of 'centered' — its 3 items are kept but won't show.",
    );

    // Footer → minimal ("no footer"), enabled purely by template default
    // still counts — the operator's page loses a rendered region.
    const footerCase = computeTemplateSwitch({ version: 1, template: "centered" }, "minimal");
    expect(
      footerCase.confirmations.some((line) => line.startsWith("Footer isn't part of 'minimal'")),
    ).toBe(true);

    // Trust strip with 2 logos → header-footer.
    const trustCase = computeTemplateSwitch(richCenteredConfig(), "header-footer");
    expect(trustCase.confirmations).toContain(
      "Trust strip isn't part of 'header-footer' — its 2 logos are kept but won't show.",
    );

    // A supported region never confirms: trust strip centered → white-trust.
    const supported = computeTemplateSwitch(
      { version: 1, template: "centered", trust_strip: { enabled: true, logos: [{ media_id: "l/a.png", alt: "A" }] } },
      "white-trust",
    );
    expect(supported.confirmations.some((line) => line.includes("Trust strip"))).toBe(false);
  });

  it("confirmation (b): section_slot.card change (card ⇄ bare) — both directions, and only on a change", () => {
    // centered (card) → minimal (bare).
    const toBare = computeTemplateSwitch({ version: 1, template: "centered" }, "minimal");
    expect(toBare.confirmations).toContain("The question unit changes from a card to a bare layout.");
    // minimal (bare) → centered (card).
    const toCard = computeTemplateSwitch({ version: 1, template: "minimal" }, "centered");
    expect(toCard.confirmations).toContain("The question unit changes from a bare layout to a card.");
    // centered (card) → full-background (card): no card confirmation.
    const same = computeTemplateSwitch({ version: 1, template: "centered" }, "full-background");
    expect(same.confirmations.some((line) => line.includes("question unit"))).toBe(false);
  });

  it("confirmation (c): a manual logo stops rendering (logo_source resets to site branding; the media ref is kept)", () => {
    const current: StoredFrameConfig = {
      version: 1,
      template: "centered",
      header: { logo_source: "manual", logo_media_id: "logos/custom.png" },
    };
    const { merged, confirmations } = computeTemplateSwitch(current, "header-footer");
    expect(confirmations.some((line) => line.includes("manual logo stops rendering"))).toBe(true);
    // The policy field is layout-replaced; the media ref is content — kept.
    expect(merged.header?.logo_source).toBeUndefined();
    expect(merged.header?.logo_media_id).toBe("logos/custom.png");
    expect(effectiveFrame(merged).frame.header.logo_source).toBe("site");

    // No manual logo → no (c) line.
    const plain = computeTemplateSwitch({ version: 1, template: "centered" }, "header-footer");
    expect(plain.confirmations.some((line) => line.includes("manual logo"))).toBe(false);
  });

  it("confirmation (c): a background image under a replaced background arrangement", () => {
    // full-background (style brand) + image → centered (style flat): fires.
    const fromBrand = computeTemplateSwitch(
      { version: 1, template: "full-background", background: { image_media_id: "bg/hero.png" } },
      "centered",
    );
    expect(fromBrand.confirmations.some((line) => line.includes("background image"))).toBe(true);
    // The image itself is preserved media (§4.3 content row).
    expect(fromBrand.merged.background?.image_media_id).toBe("bg/hero.png");

    // centered (flat) + image → white-trust (flat): arrangement unchanged — silent.
    const flatToFlat = computeTemplateSwitch(
      { version: 1, template: "centered", background: { image_media_id: "bg/hero.png" } },
      "white-trust",
    );
    expect(flatToFlat.confirmations.some((line) => line.includes("background image"))).toBe(false);
  });

  it("switch-back revives inert groups — data is never deleted by a switch", () => {
    const current: StoredFrameConfig = {
      version: 1,
      template: "centered",
      footer: { enabled: true, description: "Legal line", links: [{ label: "Privacy", href: "/privacy" }] },
      trust_strip: { enabled: true, logos: [{ media_id: "logos/a.png", alt: "A" }] },
    };

    // → minimal: footer + trust strip go inert (target defaults: off), their
    // content stays in the stored config.
    const away = computeTemplateSwitch(current, "minimal");
    const awayFrame = effectiveFrame(away.merged).frame;
    expect(awayFrame.footer.enabled).toBe(false);
    expect(awayFrame.trust_strip.enabled).toBe(false);
    expect(away.merged.footer?.description).toBe("Legal line");
    expect(away.merged.trust_strip?.logos).toEqual([{ media_id: "logos/a.png", alt: "A" }]);

    // → back to centered: the footer REVIVES automatically (centered renders
    // a footer by default) WITH the preserved content; the content-requiring
    // trust strip keeps its data ready for one re-enable toggle.
    const back = computeTemplateSwitch(away.merged, "centered");
    const backFrame = effectiveFrame(back.merged).frame;
    expect(backFrame.footer.enabled).toBe(true);
    expect(backFrame.footer.description).toBe("Legal line");
    expect(backFrame.footer.links).toEqual([{ label: "Privacy", href: "/privacy" }]);
    expect(back.merged.trust_strip?.logos).toEqual([{ media_id: "logos/a.png", alt: "A" }]);
    expect(backFrame.trust_strip.logos).toEqual([{ media_id: "logos/a.png", alt: "A" }]);
  });

  it("first adoption (no stored frame) = a bare template pick with zero confirmations", () => {
    const { merged, confirmations } = computeTemplateSwitch(null, "header-cta");
    expect(merged).toEqual({ version: 1, template: "header-cta" });
    expect(confirmations).toEqual([]);
    expect(effectiveFrame(merged).frame).toEqual(FRAME_TEMPLATES["header-cta"].defaults);
  });

  it("unknown target id falls back to 'centered' with a notice (§4.3 fallback mirror)", () => {
    const { merged, confirmations } = computeTemplateSwitch({ version: 1, template: "centered" }, "vaporwave");
    expect(merged.template).toBe("centered");
    expect(confirmations.some((line) => line.includes("'vaporwave'"))).toBe(true);
  });

  it("is PURE (C5 preview-before-apply): inputs are never mutated and results share no references", () => {
    const current = richCenteredConfig();
    const snapshot = JSON.parse(JSON.stringify(current)) as unknown;
    const { merged } = computeTemplateSwitch(current, "minimal");
    expect(current).toEqual(snapshot); // untouched
    // Mutating the result must not reach back into the input.
    (merged.footer as Record<string, unknown>)["description"] = "MUTATED";
    (merged.trust_strip?.logos as unknown as Array<Record<string, unknown>>)[0]!["alt"] = "MUTATED";
    expect(current.footer?.description).toBe("Legal description line");
    expect(current.trust_strip?.logos?.[0]?.alt).toBe("A");
  });

  it("every merged result stays schema-valid with zero error-severity problems", () => {
    const cases: Array<[StoredFrameConfig | null, string]> = [
      [richCenteredConfig(), "header-footer"],
      [richCenteredConfig(), "minimal"],
      [richCenteredConfig(), "full-background"],
      [richCenteredConfig(), "header-cta"],
      [null, "white-trust"],
      [{ version: 1, template: "minimal" }, "centered"],
    ];
    for (const [current, target] of cases) {
      const { merged } = computeTemplateSwitch(current, target);
      const { problems } = validateFrameConfig(merged);
      const errors = problems.filter((p) => p.severity === "error");
      expect(errors, `${target}: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });
});
