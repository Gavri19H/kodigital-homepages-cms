// T-H — writer-side per-generation overrides (A3 settable system prompt +
// the panel's dynamic placements). Precedence: writer override > preset >
// tone default; the content_mapping override REPLACES the preset mapping
// (the panel sends the full effective object); absent overrides are inert.

import { describe, expect, it } from "vitest";
import { applyChatPreset } from "../src/admin/ai-chat-preset";
import { applyPreset } from "../src/ai/generators/preset-engine";

function preset(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: "p",
    prompt_template: null,
    system_prompt_template: "You are the {{vertical}} voice.",
    user_prompt_template: "Write about {{vertical}}.",
    text_model: null,
    content_mapping: JSON.stringify({ title: true, excerpt: true }),
    output_rules: null,
    variables_schema: null,
    ...overrides,
  } as never;
}

const VARS = { vertical: "careers" };

describe("T-H: system prompt override precedence", () => {
  it("no override → the preset's interpolated system prompt", () => {
    const applied = applyChatPreset({ preset: preset(), variables: VARS });
    expect(applied.systemPrompt).toContain("You are the careers voice.");
    expect(applied.presetApplied).toBe(true);
  });

  it("writer override replaces the preset voice (directives still fold in)", () => {
    const withRules = preset({ output_rules: JSON.stringify(["Keep it short."]) });
    const applied = applyChatPreset({
      preset: withRules,
      variables: VARS,
      overrides: { systemPrompt: "Write like a {{vertical}} pirate." },
    });
    expect(applied.systemPrompt).toContain("Write like a careers pirate.");
    expect(applied.systemPrompt).not.toContain("You are the careers voice.");
    expect(applied.systemPrompt).toContain("Keep it short.");
  });

  it("override applies even with no preset (tone default skipped)", () => {
    const applied = applyChatPreset({
      preset: null,
      options: { tone: "casual" },
      overrides: { systemPrompt: "Custom voice." },
    });
    expect(applied.systemPrompt).toBe("Custom voice.");
    expect(applied.toneApplied).toBe(null);
  });

  it("empty override is inert (tone default kept)", () => {
    const applied = applyChatPreset({
      preset: null,
      options: { tone: "casual" },
      overrides: { systemPrompt: "   " },
    });
    expect(applied.toneApplied).toBe("casual");
  });
});

describe("T-H: content mapping override replaces the preset mapping", () => {
  it("override mapping drives the folded directive", () => {
    const applied = applyPreset({
      preset: preset(),
      variables: VARS,
      overrides: {
        contentMapping: JSON.stringify({
          excerpt: true,
          paragraph_count: 4,
          image_prompts: { hero_image: "A calm hero" },
        }),
      },
    });
    expect(applied.directives).toContain("excerpt");
    expect(applied.directives).not.toContain("title");
    expect(applied.directives).toContain("Write 4 paragraphs.");
    expect(applied.imageOptions).toEqual({ hero_image: "A calm hero" });
  });

  it("absent override keeps the preset mapping byte-identically", () => {
    const withoutOverride = applyPreset({ preset: preset(), variables: VARS });
    const withEmpty = applyPreset({
      preset: preset(),
      variables: VARS,
      overrides: { contentMapping: "" },
    });
    expect(withEmpty.directives).toBe(withoutOverride.directives);
    expect(withoutOverride.directives).toContain("title");
  });
});
