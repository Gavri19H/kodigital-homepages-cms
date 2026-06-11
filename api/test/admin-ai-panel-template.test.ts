// T28 [B8] AI assistant panel port — template-level acceptance tests.
//
// T28.AC3: the article form page contains the AI assistant panel and its
// preset select. T28.AC4: the ported AI-assistant inline script stays ES5 —
// zero arrow/const/let tokens in the script STRING (script-extraction
// assertion, not a whole-file grep of the TS module, which legitimately
// uses ES6 at module level).

import { describe, it, expect } from "vitest";
import { articleFormPage } from "../src/admin/templates/articles";
import {
  aiAssistantScripts,
  renderAIAssistantPanel,
} from "../src/admin/templates/ai-panel";
import {
  SUPPORTED_IMAGE_MODELS,
  SUPPORTED_TEXT_MODELS,
} from "../src/ai/models";

const SITES = [{ id: "site-1", name: "Site One" }];
const CATEGORIES = [{ id: "cat-1", name: "News" }];

// Inline <script> payloads of a rendered page (script-extraction, AC4).
function extractInlineScripts(html: string): string {
  const blocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? [];
  return blocks.join("\n");
}

describe("admin AI assistant panel template (T28 [B8])", () => {
  it("T28.AC3: articleFormPage contains the AI assistant panel and preset select", () => {
    const html = articleFormPage(null, SITES, CATEGORIES, {});
    expect(html).toContain('id="ai-assistant-panel"');
    expect(html).toContain("AI Assistant");
    expect(html).toContain('id="ai-preset-select"');
    expect(html).toContain('class="form-select ai-preset-select"');
    // Edit mode renders the panel too.
    const editHtml = articleFormPage(
      { id: "a-1", title: "T", site_id: "site-1" },
      SITES,
      CATEGORIES,
      {},
    );
    expect(editHtml).toContain('id="ai-assistant-panel"');
    expect(editHtml).toContain('id="ai-preset-select"');
  });

  it("panel targets the real AI endpoints (chat, image, presets) and no legacy routes", () => {
    const html = articleFormPage(null, SITES, CATEGORIES, {});
    const scripts = extractInlineScripts(html);
    expect(scripts).toContain("/api/admin/ai/chat");
    expect(scripts).toContain("/api/admin/ai/image");
    expect(scripts).toContain("/api/admin/ai/presets");
    // Legacy endpoint names must not survive the port (T28.AC1 wording).
    expect(html).not.toContain("generate-text");
    expect(html).not.toContain("generate-image");
  });

  it("models shown come from the SUPPORTED registry lists only", () => {
    const panel = renderAIAssistantPanel();
    for (const m of SUPPORTED_TEXT_MODELS) {
      expect(panel).toContain(m);
    }
    for (const m of SUPPORTED_IMAGE_MODELS) {
      expect(panel).toContain(m);
    }
    // Retired legacy model ids never render (T28.AC2 wording).
    expect(panel).not.toContain("gpt-4o");
    expect(panel).not.toContain("gpt-image-1");
  });

  it("T28.AC4: ported AI-assistant inline script is ES5-only (zero arrow/const/let in the script string)", () => {
    // The exported script string itself…
    expect(aiAssistantScripts.match(/=>/g) ?? []).toHaveLength(0);
    expect(aiAssistantScripts.match(/\bconst\b/g) ?? []).toHaveLength(0);
    expect(aiAssistantScripts.match(/\blet\b/g) ?? []).toHaveLength(0);
    // …and the full inline-script payload of the rendered form page
    // (layout + editor + form + AI panel chunks stay ES5 together).
    const scripts = extractInlineScripts(
      articleFormPage(null, SITES, CATEGORIES, {}),
    );
    expect(scripts).toContain("ai-assistant-panel");
    expect(scripts.match(/=>/g) ?? []).toHaveLength(0);
    expect(scripts.match(/\bconst\b/g) ?? []).toHaveLength(0);
    expect(scripts.match(/\blet\b/g) ?? []).toHaveLength(0);
  });
});
