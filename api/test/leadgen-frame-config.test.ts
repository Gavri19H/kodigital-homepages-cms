// LeadGen v2.5 Phase A — contract test `frame-config-serialization`
// (redesign-contract-v2.5 03 §3.3/§3.6). Proves: the frame_config_json schema
// ROUND-TRIPS (validate(JSON.parse(JSON.stringify(cfg))) echoes the config
// with zero problems); unknown keys are REJECTED at every level (top, group,
// nested object, list entry); closed-set enum violations produce PATH-PRECISE
// §3.6 problems (scope `frame`, operator-language message, never raw JSON);
// colours are role names; href/tel follow the SAFE_HREF rule.

import { describe, expect, it } from "vitest";
import { validateFrameConfig, FRAME_TEMPLATE_IDS } from "../src/public/leadgen/designs/frames";

// A fully-populated, valid stored config exercising EVERY §3.3 group + field.
function fullConfig(): Record<string, unknown> {
  return {
    version: 1,
    template: "header-cta",
    compat: { allow_section_chrome: false },
    header: {
      enabled: true,
      logo_source: "site",
      logo_media_id: null,
      logo_size: "l",
      logo_align: "center",
      tagline: "Compare and save",
      secure_badge: { enabled: true, text: "Your information is secure" },
      cta: { enabled: true, label: "Call now", href: null, tel: "tel:+15551234567" },
      disclosure_link: true,
      sticky: false,
    },
    progress: {
      style: "percent",
      position: "above_unit",
      thickness: "s",
      width: "full",
      color_role: "accent",
      show_label: true,
    },
    back: { style: "icon_text", position: "below_card", label: "Go back", history_fallback: false },
    disclosure: {
      enabled: true,
      location: "top_bar",
      link_label: "Advertising Disclosure",
      text: "We may receive compensation from our partners.",
    },
    footer: {
      enabled: true,
      show_on: "final",
      links_source: "manual",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "https://example.com/terms" },
      ],
      trust_text: "Trusted by thousands",
      description: "Operated by Example Inc.",
      show_logo: true,
      hide_on_mobile: true,
    },
    trust_strip: {
      enabled: true,
      source: "manual",
      logos: [{ media_id: "med_abc123", alt: "Example partner logo" }],
      placement: "between_progress_and_unit",
      mobile: "scroll",
    },
    benefit_bar: {
      enabled: true,
      items: [{ icon: "shield", text: "Free to use" }],
      placement: "bottom",
    },
    background: { role: "surface_wash", image_media_id: "med_bg1", style: "brand_gradient" },
    section_slot: {
      max_width: "l",
      align: "center",
      card: "bare",
      padding: "s",
      offset_y: "m",
      allow_section_card: false,
      transition: "none",
      continue_placement: "below_unit",
      continue_style_role: "button_primary",
    },
    mobile: { hide_footer: true, progress_position: "top", logo_size: "s", trust_strip_mobile: "hide" },
  };
}

// ---------------------------------------------------------------------------
// schema round-trip
// ---------------------------------------------------------------------------

describe("frame-config-serialization — §3.3 schema round-trip", () => {
  it("a fully-populated valid config validates with ZERO problems and echoes intact", () => {
    const original = fullConfig();
    const { config, problems } = validateFrameConfig(original);
    expect(problems).toEqual([]);
    expect(config).not.toBeNull();
    expect(config).toEqual(original);
  });

  it("survives a JSON round-trip byte-for-byte (stringify → parse → validate → deep-equal)", () => {
    const original = fullConfig();
    const parsed: unknown = JSON.parse(JSON.stringify(original));
    const { config, problems } = validateFrameConfig(parsed);
    expect(problems).toEqual([]);
    expect(config).toEqual(original);
  });

  it("a SPARSE config is valid — every group optional, template defaults apply (§3.3)", () => {
    const { config, problems } = validateFrameConfig({});
    expect(problems).toEqual([]);
    expect(config).toEqual({});

    const sparse = { header: { tagline: "Hi" }, progress: { style: "dots" } };
    const result = validateFrameConfig(sparse);
    expect(result.problems).toEqual([]);
    expect(result.config).toEqual(sparse);
  });

  it("non-object input → null config + a `frame`-path error", () => {
    for (const junk of [null, "config", 7, ["header"]]) {
      const { config, problems } = validateFrameConfig(junk);
      expect(config).toBeNull();
      expect(problems).toHaveLength(1);
      expect(problems[0]?.path).toBe("frame");
      expect(problems[0]?.severity).toBe("error");
    }
  });

  it("version must be 1; template must be one of the 6 registry ids", () => {
    const badVersion = validateFrameConfig({ version: 2 });
    expect(badVersion.config).toBeNull();
    expect(badVersion.problems[0]?.path).toBe("frame.version");

    const badTemplate = validateFrameConfig({ template: "vintage" });
    expect(badTemplate.config).toBeNull();
    expect(badTemplate.problems[0]?.path).toBe("frame.template");
    for (const id of FRAME_TEMPLATE_IDS) {
      expect(badTemplate.problems[0]?.message).toContain(id);
      expect(validateFrameConfig({ template: id }).problems).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// unknown keys rejected (top, group, nested object, list entry, mobile)
// ---------------------------------------------------------------------------

describe("frame-config-serialization — unknown keys rejected at every level (§3.3)", () => {
  it("unknown TOP-LEVEL key → error at frame.<key>", () => {
    const { config, problems } = validateFrameConfig({ funky: {} });
    expect(config).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: "frame.funky", scope: "frame", severity: "error" });
    expect(problems[0]?.message).toContain("funky");
  });

  it("unknown GROUP key → error at frame.header.<key>", () => {
    const { config, problems } = validateFrameConfig({ header: { funky: true } });
    expect(config).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe("frame.header.funky");
  });

  it("unknown NESTED-OBJECT key → error at frame.header.cta.<key>", () => {
    const { config, problems } = validateFrameConfig({ header: { cta: { funky: 1 } } });
    expect(config).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe("frame.header.cta.funky");
  });

  it("unknown LIST-ENTRY key → error at frame.footer.links[0].<key>", () => {
    const { config, problems } = validateFrameConfig({
      footer: { links: [{ label: "A", href: "/a", funky: 1 }] },
    });
    expect(config).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe("frame.footer.links[0].funky");
  });

  it("mobile group accepts ONLY its 4 sparse keys (§3.3 'only keys listed here')", () => {
    const ok = validateFrameConfig({ mobile: { hide_footer: true, progress_position: "top" } });
    expect(ok.problems).toEqual([]);
    const bad = validateFrameConfig({ mobile: { desktop_only: true } });
    expect(bad.config).toBeNull();
    expect(bad.problems[0]?.path).toBe("frame.mobile.desktop_only");
  });
});

// ---------------------------------------------------------------------------
// enum violations → path-precise §3.6 problems
// ---------------------------------------------------------------------------

describe("frame-config-serialization — enum violations produce path-precise problems (§3.6)", () => {
  it("closed-set enum violation names the exact path + the allowed values", () => {
    const { config, problems } = validateFrameConfig({ progress: { style: "spiral" } });
    expect(config).toBeNull();
    expect(problems).toHaveLength(1);
    const problem = problems[0];
    expect(problem).toMatchObject({ path: "frame.progress.style", scope: "frame", severity: "error" });
    // P8-6 Q8 re-pin. WAS: a loop asserting the message contained each of the
    // 5 raw stored ids ("hidden", "bar", …) — which is exactly the raw-key dump
    // M5 removes, so the old loop PINNED THE DEFECT. Now the whole sentence is
    // pinned verbatim (STRONGER: word order, punctuation and the 6th value
    // "Icon on track" are all covered, where the loop checked 5 substrings in
    // any order), plus an explicit ban on the raw ids coming back.
    expect(problem?.message).toBe(
      "The progress 'style' setting must be one of: No progress bar, Bar, Dots, Numbered, Percent, Icon on track.",
    );
    for (const rawId of ["hidden", "icon_on_track", "under_header"]) {
      expect(problem?.message, `raw stored id ${rawId} must not reach the operator`).not.toContain(rawId);
    }
  });

  it("colour fields accept ROLE NAMES only (§3.3 'all colors are role names')", () => {
    const bad = validateFrameConfig({ progress: { color_role: "hotpink" } });
    expect(bad.config).toBeNull();
    expect(bad.problems[0]?.path).toBe("frame.progress.color_role");
    // P8-6 Q8 re-pin. WAS: .toContain("brand_primary") — the raw role id, which
    // the M5 rewrite replaced with the operator's own "Brand primary". STRONGER
    // now: the full sentence (all 14 role labels, in order) plus a ban on the
    // raw id, instead of one substring.
    expect(bad.problems[0]?.message).toBe(
      "The progress 'color role' setting must be a theme colour role: Brand primary, Brand secondary, Accent, " +
        "Success, Error, Page background, Card background, Soft fill, Border, Text, Muted text, Button, " +
        "Button text, Secondary button.",
    );
    expect(bad.problems[0]?.message).not.toContain("brand_primary");

    expect(validateFrameConfig({ progress: { color_role: "accent" } }).problems).toEqual([]);
    const badBg = validateFrameConfig({ background: { role: "#FF0000" } });
    expect(badBg.problems[0]?.path).toBe("frame.background.role");
  });

  it("boolean and text fields are type-checked with precise paths", () => {
    const badBool = validateFrameConfig({ header: { sticky: "yes" } });
    expect(badBool.problems[0]?.path).toBe("frame.header.sticky");

    const badText = validateFrameConfig({ header: { tagline: 42 } });
    expect(badText.problems[0]?.path).toBe("frame.header.tagline");
    expect(validateFrameConfig({ header: { tagline: null } }).problems).toEqual([]);
  });

  it("a group that isn't an object is a single group-path error", () => {
    for (const junk of [[], "chrome", 3]) {
      const { config, problems } = validateFrameConfig({ header: junk });
      expect(config).toBeNull();
      expect(problems).toHaveLength(1);
      expect(problems[0]?.path).toBe("frame.header");
    }
  });

  it("messages are operator sentences — never raw JSON (§3.6)", () => {
    const { problems } = validateFrameConfig({
      chrome: {},
      header: { sticky: "yes", cta: { enabled: true, href: "javascript:alert(1)" } },
      progress: { style: "spiral", color_role: "hotpink" },
      trust_strip: { logos: [{ media_id: "" }] },
    });
    expect(problems.length).toBeGreaterThan(3);
    for (const problem of problems) {
      expect(problem.scope).toBe("frame");
      expect(problem.path.startsWith("frame")).toBe(true);
      expect(problem.message).not.toContain("{");
      expect(problem.message).not.toContain("}");
      expect(problem.message.endsWith(".")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// SAFE_HREF rule + structured cross-rules
// ---------------------------------------------------------------------------

describe("frame-config-serialization — SAFE_HREF + structured rules (§3.3)", () => {
  it("cta href: javascript:/data:/protocol-relative rejected; https/relative/#/tel:/mailto: accepted", () => {
    for (const evil of ["javascript:alert(1)", "data:text/html,x", "//evil.example.com"]) {
      const { config, problems } = validateFrameConfig({ header: { cta: { href: evil } } });
      expect(config).toBeNull();
      expect(problems[0]?.path).toBe("frame.header.cta.href");
    }
    for (const ok of ["https://example.com", "/path", "#disclosure", "tel:+15551234567", "mailto:a@b.co"]) {
      expect(validateFrameConfig({ header: { cta: { href: ok } } }).problems).toEqual([]);
    }
  });

  it("footer link hrefs follow the same SAFE_HREF rule with indexed paths", () => {
    const { problems } = validateFrameConfig({
      footer: {
        links: [
          { label: "Fine", href: "/ok" },
          { label: "Evil", href: "javascript:void(0)" },
        ],
      },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe("frame.footer.links[1].href");
  });

  it("cta tel accepts phone-shaped values only", () => {
    expect(validateFrameConfig({ header: { cta: { tel: "+1 (555) 123-4567" } } }).problems).toEqual([]);
    expect(validateFrameConfig({ header: { cta: { tel: "tel:+15551234567" } } }).problems).toEqual([]);
    const bad = validateFrameConfig({ header: { cta: { tel: "call-me-maybe" } } });
    expect(bad.problems[0]?.path).toBe("frame.header.cta.tel");
  });

  it("an ENABLED cta requires a label and a phone number or link (§3.3 '{enabled, label, tel|href}')", () => {
    const { config, problems } = validateFrameConfig({ header: { cta: { enabled: true } } });
    expect(config).toBeNull();
    const paths = problems.map((p) => p.path).sort();
    expect(paths).toEqual(["frame.header.cta", "frame.header.cta.label"]);
    expect(
      validateFrameConfig({ header: { cta: { enabled: true, label: "Call now", tel: "+15551234567" } } })
        .problems,
    ).toEqual([]);
    // disabled cta carries no such requirement
    expect(validateFrameConfig({ header: { cta: { enabled: false } } }).problems).toEqual([]);
  });

  it("trust logos require media_id AND alt (§3.3 'alt REQUIRED')", () => {
    const noAlt = validateFrameConfig({ trust_strip: { logos: [{ media_id: "med_1" }] } });
    expect(noAlt.config).toBeNull();
    expect(noAlt.problems[0]?.path).toBe("frame.trust_strip.logos[0].alt");

    const noMedia = validateFrameConfig({ trust_strip: { logos: [{ alt: "Partner" }] } });
    expect(noMedia.problems[0]?.path).toBe("frame.trust_strip.logos[0].media_id");

    expect(
      validateFrameConfig({ trust_strip: { logos: [{ media_id: "med_1", alt: "Partner" }] } }).problems,
    ).toEqual([]);
  });

  it("benefit items require icon + text", () => {
    const { problems } = validateFrameConfig({ benefit_bar: { items: [{ icon: "shield" }] } });
    expect(problems[0]?.path).toBe("frame.benefit_bar.items[0].text");
  });

  it("manual logo source → WARNING (§4.4) and requires a logo image; warnings keep the config", () => {
    const withMedia = validateFrameConfig({ header: { logo_source: "manual", logo_media_id: "med_9" } });
    expect(withMedia.problems).toHaveLength(1);
    expect(withMedia.problems[0]).toMatchObject({
      path: "frame.header.logo_source",
      severity: "warning",
      message: "Manual logo overrides site branding.",
    });
    expect(withMedia.config).not.toBeNull(); // warning-only → config kept

    const withoutMedia = validateFrameConfig({ header: { logo_source: "manual" } });
    expect(withoutMedia.config).toBeNull();
    const errorPaths = withoutMedia.problems.filter((p) => p.severity === "error").map((p) => p.path);
    expect(errorPaths).toEqual(["frame.header.logo_media_id"]);
  });
});
