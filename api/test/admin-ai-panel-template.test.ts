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
    // The exported AI-assistant script string itself stays ES5 (this is the
    // subject of T28 — the ported AI panel). NOTE: the article form page also
    // embeds the new per-block editor script (editorScripts), which is an ES6+
    // class-based module by design, so the whole-page inline-script payload is
    // NOT ES5 — only the AI-assistant chunk is asserted here.
    expect(aiAssistantScripts.match(/=>/g) ?? []).toHaveLength(0);
    expect(aiAssistantScripts.match(/\bconst\b/g) ?? []).toHaveLength(0);
    expect(aiAssistantScripts.match(/\blet\b/g) ?? []).toHaveLength(0);
    // The AI-assistant panel script is actually emitted into the rendered form
    // (its distinctive markers survive into the page's inline <script> payload).
    const scripts = extractInlineScripts(
      articleFormPage(null, SITES, CATEGORIES, {}),
    );
    expect(scripts).toContain("ai-assistant-panel");
    expect(scripts).toContain("quick-action");
    expect(scripts).toContain("/api/admin/ai/chat");
  });
});

// T14.AC1 (behavioral): the editor handler emits the FULL legacy AI assistant
// panel — the four quick actions, the preset selector with variables +
// prompt-preview, tone/length controls, and the structured auto-fill wiring —
// not the prior stub. Every assertion below fails on the stub, so a green run
// proves the port actually happened in the EMITTED HTML.
describe("article editor: full legacy AI assistant panel (T14.AC1)", () => {
  const editorHtml = () => articleFormPage(null, SITES, CATEGORIES, {});

  it("emits the four quick-action handlers (outline, draft, rewrite, seo_meta)", () => {
    const html = editorHtml();
    for (const action of ["outline", "draft", "rewrite", "seo_meta"]) {
      expect(html).toContain(`data-quick-action="${action}"`);
    }
    // Visible labels port the legacy quick-action panel.
    expect(html).toContain(">Outline<");
    expect(html).toContain(">Draft<");
    expect(html).toContain(">Rewrite<");
    expect(html).toContain(">SEO Meta<");
    // The handlers fire the real chat endpoint (no orphaned buttons).
    const scripts = extractInlineScripts(html);
    expect(scripts).toContain("data-quick-action");
    expect(scripts).toContain("buildQuickPrompt");
    expect(scripts).toContain("/api/admin/ai/chat");
  });

  it("preset selector renders {{variable}} chips + a live interpolated prompt-preview", () => {
    const html = editorHtml();
    expect(html).toContain('id="ai-preset-select"');
    expect(html).toContain('id="ai-preset-variables"');
    expect(html).toContain('id="ai-preset-preview"');
    const scripts = extractInlineScripts(html);
    // auto-detect {{token}} variables, render an input per variable, and
    // interpolate them into the preview on change/input.
    expect(scripts).toContain("detectTokens");
    expect(scripts).toContain("interpolate");
    expect(scripts).toContain("renderPreview");
    expect(scripts).toContain("data-var-name");
    // the preview is driven from the preset's system/user prompt split.
    expect(scripts).toContain("system_prompt_template");
    expect(scripts).toContain("user_prompt_template");
  });

  it("renders tone and length controls", () => {
    const html = editorHtml();
    expect(html).toContain('id="ai-tone"');
    expect(html).toContain('id="ai-length"');
    expect(html).toContain(">Tone<");
    expect(html).toContain(">Length<");
    // controls feed the quick-action prompt builder.
    const scripts = extractInlineScripts(html);
    expect(scripts).toContain("toneEl");
    expect(scripts).toContain("lengthEl");
  });

  it("ai-results wiring parses structured JSON and auto-fills title/excerpt/meta/author", () => {
    const html = editorHtml();
    expect(html).toContain('id="ai-results"');
    const scripts = extractInlineScripts(html);
    // structured JSON reply is parsed…
    expect(scripts).toContain("extractStructured");
    expect(scripts).toContain("JSON.parse");
    expect(scripts).toContain("applyStructured");
    // …and each declared target field is filled from it.
    expect(scripts).toContain("#article-title");
    expect(scripts).toContain("#article-excerpt");
    expect(scripts).toContain("#article-seo-description");
    expect(scripts).toContain('[name="author_name"]');
  });

  it("the {{token}} detector regex is correctly double-escaped in the ES5 string", () => {
    // The script is exported as a template literal, so `\\{` emits `\{`; a
    // missed escape would collapse to a bare `{{` and silently break variable
    // detection in the browser. Assert the emitted regex source carries the
    // escaped brace metacharacters (deterministic, no dynamic eval).
    expect(aiAssistantScripts).toContain("TOKEN_RE");
    expect(aiAssistantScripts).toContain("\\{\\{");
    expect(aiAssistantScripts).toContain("\\}\\}");
  });
  it("PR-3 (issue 12): exposes FAQ + Key idea quick actions alongside the original four", () => {
    const html = renderAIAssistantPanel();
    for (const action of ["outline", "draft", "rewrite", "seo_meta", "faq", "key_idea"]) {
      expect(html).toContain(`data-quick-action="${action}"`);
    }
    expect(html).toContain(">FAQ<");
    expect(html).toContain(">Key idea<");
  });

  it("PR-3 (issue 12): the script builds structured FAQ + Key-idea prompts and inserts the matching blocks", () => {
    const html = articleFormPage(null, SITES, CATEGORIES, {});
    const scripts = extractInlineScripts(html);
    // Prompt builders ask for the documented structured shapes.
    expect(scripts).toContain('"faqs"');
    expect(scripts).toContain('"key_idea"');
    // The structured-insert helpers add the editor blocks chosen for storage:
    // faqs -> ONE faqgroup block; key_idea -> a pullquote block.
    expect(scripts).toContain("addBlock('faqgroup'");
    expect(scripts).toContain("addBlock('pullquote'");
    expect(scripts).toContain("insertFaqs");
    expect(scripts).toContain("insertKeyIdea");
  });

  it("PR-3: the AI panel script stays ES5 (no arrow/const/let) after the FAQ + Key-idea additions", () => {
    // Re-assert the AC4 invariant against the FINAL script string so the new
    // handlers can never regress the panel to ES6 (the var/function port).
    expect(aiAssistantScripts.match(/=>/g) ?? []).toHaveLength(0);
    expect(aiAssistantScripts.match(/\bconst\b/g) ?? []).toHaveLength(0);
    expect(aiAssistantScripts.match(/\blet\b/g) ?? []).toHaveLength(0);
  });
});
