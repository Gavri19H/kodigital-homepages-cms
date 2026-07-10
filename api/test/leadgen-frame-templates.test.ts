// LeadGen v2.5 Phase A — contract test `frame-template-merge`
// (redesign-contract-v2.5 04 §4.3 + 13 §13.2). Proves: FRAME_TEMPLATES carries
// the 6 template ids with complete per-group defaults matching the §4.3
// arrangement table, every template's defaults validate with ZERO problems;
// effectiveFrame applies template ⊕ funnel ⊕ variant precedence as ONE sparse
// deep-merge (arrays replaced whole, absent keys inherit), and an unknown
// template id in STORED json falls back to `centered` with a problems[]
// warning (mirror of the design-registry unknown-id rule).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAME_TEMPLATE_ID,
  FRAME_TEMPLATES,
  FRAME_TEMPLATE_IDS,
  effectiveFrame,
  validateFrameConfig,
} from "../src/public/leadgen/designs/frames";
import type { FrameConfig, FrameOverrides } from "../src/public/leadgen/designs/frames";

// ---------------------------------------------------------------------------
// registry shape + per-template §4.3 defaults
// ---------------------------------------------------------------------------

describe("frame-template-merge — the 6-template registry (§4.3, code not DB)", () => {
  it("registers exactly the 6 contract template ids", () => {
    expect(FRAME_TEMPLATE_IDS).toEqual([
      "centered",
      "header-footer",
      "header-cta",
      "full-background",
      "white-trust",
      "minimal",
    ]);
    expect(Object.keys(FRAME_TEMPLATES).sort()).toEqual([...FRAME_TEMPLATE_IDS].sort());
    expect(DEFAULT_FRAME_TEMPLATE_ID).toBe("centered");
  });

  for (const id of FRAME_TEMPLATE_IDS) {
    it(`'${id}' defaults are complete, self-labelled, and validate with ZERO problems`, () => {
      const def = FRAME_TEMPLATES[id];
      expect(def.id).toBe(id);
      expect(def.defaults.template).toBe(id);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.arrangement.length).toBeGreaterThan(0);
      const { config, problems } = validateFrameConfig(def.defaults);
      expect(problems).toEqual([]);
      expect(config).not.toBeNull();
    });
  }

  it("centered = Pattern A reference-style (§3.3 schema defaults verbatim)", () => {
    const d = FRAME_TEMPLATES.centered.defaults;
    expect(d.header.logo_align).toBe("center");
    expect(d.progress.style).toBe("bar");
    expect(d.section_slot.card).toBe("card");
    expect(d.footer.enabled).toBe(true);
    expect(d.header.sticky).toBe(true);
    expect(d.compat.allow_section_chrome).toBe(false);
    expect(d.section_slot.continue_placement).toBe("inside_unit");
  });

  it("header-footer = site header (logo+tagline+secure) → bare slot → LARGE site footer", () => {
    const d = FRAME_TEMPLATES["header-footer"].defaults;
    expect(d.header.logo_align).toBe("left");
    expect(d.header.secure_badge.enabled).toBe(true);
    expect(d.section_slot.card).toBe("bare");
    expect(d.footer.show_logo).toBe(true);
    expect(d.footer.links_source).toBe("site");
  });

  it("header-cta = disclosure top bar → logo + call CTA slot → benefit bar → back link", () => {
    const d = FRAME_TEMPLATES["header-cta"].defaults;
    expect(d.disclosure.enabled).toBe(true);
    expect(d.disclosure.location).toBe("top_bar");
    expect(d.back.position).toBe("below_card");
    expect(d.benefit_bar.placement).toBe("below_unit");
    // content-requiring affordances stay OFF until the operator supplies copy
    expect(d.header.cta.enabled).toBe(false);
    expect(d.benefit_bar.enabled).toBe(false);
  });

  it("full-background = brand background → step dots → white card slot", () => {
    const d = FRAME_TEMPLATES["full-background"].defaults;
    expect(d.background.style).toBe("brand");
    expect(d.background.role).toBe("brand_primary");
    expect(d.progress.style).toBe("dots");
    expect(d.progress.position).toBe("above_unit");
    expect(d.section_slot.card).toBe("card");
    expect(d.header.sticky).toBe(false);
  });

  it("white-trust = white page → minimal header → bare slot → bottom trust bar", () => {
    const d = FRAME_TEMPLATES["white-trust"].defaults;
    expect(d.background.role).toBe("card_background");
    expect(d.header.logo_size).toBe("s");
    expect(d.section_slot.card).toBe("bare");
    expect(d.trust_strip.placement).toBe("footer");
  });

  it("minimal = clean header → progress → back → bare slot, NO footer", () => {
    const d = FRAME_TEMPLATES.minimal.defaults;
    expect(d.footer.enabled).toBe(false);
    expect(d.back.position).toBe("under_header_left");
    expect(d.section_slot.card).toBe("bare");
  });
});

// ---------------------------------------------------------------------------
// effectiveFrame — template ⊕ funnel ⊕ variant (§13.2)
// ---------------------------------------------------------------------------

describe("frame-template-merge — effectiveFrame precedence template ⊕ funnel ⊕ variant (§13.2)", () => {
  it("a bare template id yields exactly the template defaults (merge identity)", () => {
    const { frame, problems } = effectiveFrame("centered");
    expect(problems).toEqual([]);
    expect(frame).toEqual(FRAME_TEMPLATES.centered.defaults);
  });

  it("variant overrides beat funnel config which beats template defaults", () => {
    const funnel: FrameConfig = {
      template: "centered",
      progress: { style: "dots" },
      header: { tagline: "From funnel" },
    };
    const variant: FrameOverrides = { progress: { style: "numbered" } };
    const { frame, problems } = effectiveFrame(funnel, undefined, variant);
    expect(problems).toEqual([]);
    expect(frame.template).toBe("centered");
    expect(frame.progress.style).toBe("numbered"); // variant wins
    expect(frame.header.tagline).toBe("From funnel"); // funnel survives
    expect(frame.progress.position).toBe("under_header"); // untouched → template default
    expect(frame.header.enabled).toBe(true);
  });

  it("sparse deep-merge: a nested override keeps its siblings' defaults", () => {
    const { frame } = effectiveFrame("centered", { header: { secure_badge: { text: "Secured" } } });
    expect(frame.header.secure_badge.text).toBe("Secured");
    expect(frame.header.secure_badge.enabled).toBe(false); // sibling default intact
    expect(frame.header.logo_source).toBe("site");
  });

  it("arrays are replaced WHOLE across layers — never index-merged (§13.2)", () => {
    const funnel: FrameConfig = {
      footer: {
        links: [
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/terms" },
        ],
      },
    };
    const variant: FrameOverrides = { footer: { links: [{ label: "Contact", href: "/contact" }] } };

    const funnelOnly = effectiveFrame("centered", funnel).frame;
    expect(funnelOnly.footer.links).toEqual([
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ]);

    const withVariant = effectiveFrame("centered", funnel, variant).frame;
    expect(withVariant.footer.links).toEqual([{ label: "Contact", href: "/contact" }]);
    expect(withVariant.footer.links).toHaveLength(1); // replaced whole, not merged with funnel's 2
    expect(withVariant.footer.show_on).toBe("all"); // sibling scalar still template default
  });

  it("unknown template id in STORED json → `centered` + a problems[] warning (§4.3 fallback mirror)", () => {
    const { frame, problems } = effectiveFrame({ template: "vintage", header: { tagline: "Kept" } });
    expect(frame.template).toBe("centered");
    expect(frame.header.tagline).toBe("Kept"); // stored data still applied
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: "frame.template", scope: "frame", severity: "warning" });
  });

  it("ABSENT template → `centered` silently (a default, not a fallback warning)", () => {
    const { frame, problems } = effectiveFrame({ header: { tagline: "T" } });
    expect(frame.template).toBe("centered");
    expect(problems).toEqual([]);
    const legacy = effectiveFrame(null);
    expect(legacy.frame).toEqual(FRAME_TEMPLATES.centered.defaults);
    expect(legacy.problems).toEqual([]);
  });

  it("explicit template id + stored config = template-switch semantics: operator content preserved, layout replaced (§4.3)", () => {
    const stored: FrameConfig = { template: "centered", header: { tagline: "Kept copy" } };
    const { frame, problems } = effectiveFrame("minimal", stored);
    expect(problems).toEqual([]);
    expect(frame.template).toBe("minimal"); // the id wins over the stored one
    expect(frame.header.tagline).toBe("Kept copy"); // operator content PRESERVED
    expect(frame.footer.enabled).toBe(false); // minimal layout defaults REPLACE
    expect(frame.section_slot.card).toBe("bare");
  });

  it("a variant's `theme` key is NOT merged into the frame (it is resolveTokens layer 3, §4.5)", () => {
    const variant: FrameOverrides = {
      theme: { palette: { brand_primary: "#123456" } },
      header: { tagline: "V" },
    };
    const { frame } = effectiveFrame("centered", {}, variant);
    expect(frame.header.tagline).toBe("V");
    expect("theme" in frame).toBe(false);
  });

  it("is PURE: results never alias template defaults or mutate inputs", () => {
    const funnel: FrameConfig = { header: { tagline: "Pure" } };
    const { frame } = effectiveFrame("centered", funnel);
    frame.header.tagline = "Mutated";
    frame.footer.links.push({ label: "X", href: "/x" });

    expect(FRAME_TEMPLATES.centered.defaults.header.tagline).toBeNull();
    expect(FRAME_TEMPLATES.centered.defaults.footer.links).toEqual([]);
    expect(funnel).toEqual({ header: { tagline: "Pure" } });

    const fresh = effectiveFrame("centered").frame;
    expect(fresh.header.tagline).toBeNull();
    expect(fresh.footer.links).toEqual([]);
  });

  it("every template's effective frame (no funnel/variant layers) validates with zero problems", () => {
    for (const id of FRAME_TEMPLATE_IDS) {
      const { frame } = effectiveFrame(id);
      const { problems } = validateFrameConfig(frame);
      expect(problems, id).toEqual([]);
    }
  });
});
