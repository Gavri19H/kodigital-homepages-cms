// Round-5 Defect B class-killer + Defect A class pin.
//
// Defect B (prod screenshot 2026-07-02): author CSS `display:flex` on
// `.ai-loading` overrode the UA stylesheet's `[hidden]{display:none}`, so the
// panel rendered a permanent fake "Generating…" spinner (plus an always-
// visible empty `#ai-image-prompts` strip and a dead `#ai-preview-body`
// collapse). The kill-rule in the admin layout restores the `hidden`
// attribute's contract for EVERY admin surface with author-origin
// `!important` precedence.
//
// Defect A (billed phantom, #58 era): a quick-action click auto-selected a
// preset and fired a PAID generation immediately. The arm-then-Generate mode
// is pinned structurally here: neither the quick-action handler nor the
// preset-change handler may reach fetch()/generate().

import { describe, expect, it } from "vitest";
import { adminLayout } from "../src/admin/templates/layout";
import { aiAssistantScripts } from "../src/admin/templates/ai-panel";

describe("admin [hidden] kill-rule (Defect B class)", () => {
  it("every admin page ships [hidden]{display:none!important} in its stylesheet", () => {
    const html = adminLayout({
      title: "t",
      activeNav: "articles",
      content: "<p>x</p>",
    } as never);
    expect(html).toContain("[hidden]{display:none!important}");
  });

  it("the kill-rule precedes the component styles so it wins by !important, not order", () => {
    const html = adminLayout({
      title: "t",
      activeNav: "articles",
      content: "<p>x</p>",
    } as never);
    // !important makes order irrelevant, but the rule must live in the SHARED
    // layout styles (before any per-page styles are appended).
    const styleStart = html.indexOf("<style>");
    const rule = html.indexOf("[hidden]{display:none!important}");
    expect(styleStart).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(styleStart);
  });
});

// Extract a top-level `function NAME(...) {...}` body from the emitted panel
// script by brace counting (the script is ES5, no template literals inside).
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `function ${name} exists in the panel script`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

describe("arm-then-Generate is structural (Defect A class)", () => {
  it("a quick-action click NEVER fetches or generates — it only arms", () => {
    const body = extractFunction(aiAssistantScripts, "onQuickClick");
    expect(body).not.toMatch(/fetch\s*\(/);
    expect(body).not.toMatch(/\bgenerate\w*\s*\(/);
  });

  it("selecting a preset NEVER fetches or generates — it only loads the preset", () => {
    const body = extractFunction(aiAssistantScripts, "applySelectedPreset");
    expect(body).not.toMatch(/fetch\s*\(/);
    expect(body).not.toMatch(/\bgenerate\w*\s*\(/);
  });

  it("the cost note states what a Generate press will run", () => {
    expect(aiAssistantScripts).toContain("Generate runs 1 text generation");
    const body = extractFunction(aiAssistantScripts, "updateCostNote");
    expect(body).toContain("image generation");
  });
});
