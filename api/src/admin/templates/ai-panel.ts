// Admin AI Assistant panel — the LEGACY panel's writer flow (the richest
// version that ever shipped: theiwise-legacy-readonly articles.ts
// renderAIAssistantPanel), restored 1:1 in structure and behavior, plus the
// post-mirror additions the missions specified on top of it:
//   - A3 settable system prompt ("Edit voice" inside the resolved preview)
//   - image-prompt boxes for image-category presets (B3 consumption)
//   - the empty-completion message (#57)
//
// The legacy flow this file restores (each port since rescue-3 dropped
// parts of it):
//   Quick Actions (action MODE: highlights, clears the preset)      →
//   Use Preset (grouped select; preset MODE)                        →
//   Variables (DECLARED variables_schema only, typed inputs, a
//              required-missing warning that gates Generate)        →
//   Available Context (always-visible chips; click previews the live
//              value; values auto-resolve from the article form)    →
//   Options (Tone with a Default option / Length)                   →
//   Resolved Prompt Preview (collapsible; System + User with resolved
//              values highlighted and unresolved {{tokens}} flagged +
//              a warning strip; "Edit voice" = the A3 override)     →
//   Instructions (optional free text)                               →
//   ONE Generate button (routes /chat, or /image for image presets) →
//   Loading spinner → Results (Clear / Copy / Insert to editor).
//
// Endpoint contract:
//   GET  /api/admin/ai/presets?active_only=true  — populate the preset select
//   POST /api/admin/ai/chat   {prompt, presetId?, variables?, context?,
//                              options?, system_prompt?, site_id?}
//   POST /api/admin/ai/image  {prompt, presetId?, site_id?}
//
// Models shown in the panel come ONLY from the SUPPORTED_*_MODELS registry
// lists (../../ai/models) — never hardcoded model id literals (T28.AC2).

import { SUPPORTED_IMAGE_MODELS, SUPPORTED_TEXT_MODELS } from "../../ai/models";
import { escapeHtml } from "./layout";

export { aiAssistantScripts } from "./ai-panel-script";

// Quick-action buttons ported from the legacy panel (legacy :1644-1680).
// The data-quick-action value is the routing key the inline script reads.
const QUICK_ACTIONS: ReadonlyArray<{ action: string; label: string }> = [
  { action: "outline", label: "Outline" },
  { action: "draft", label: "Draft" },
  { action: "rewrite", label: "Rewrite" },
  { action: "seo_meta", label: "SEO Meta" },
  { action: "faq", label: "FAQ" },
  { action: "key_idea", label: "Key idea" },
];

const TONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Default" },
  { value: "professional", label: "Professional" },
  { value: "conversational", label: "Conversational" },
  { value: "friendly", label: "Friendly" },
  { value: "authoritative", label: "Authoritative" },
  { value: "casual", label: "Casual" },
];

const LENGTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "medium", label: "Medium" },
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
];

// The always-available context the panel auto-resolves from the article form
// (legacy "Available Context" section). data-context-key drives both the
// click-to-preview chip and the {{token}} resolution in the prompt preview.
const CONTEXT_CHIPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "article_title", label: "Article Title" },
  { key: "category_name", label: "Category" },
  { key: "article_excerpt", label: "Excerpt" },
  { key: "selected_text", label: "Selected Text" },
  { key: "brand_name", label: "Site" },
];

function renderQuickActions(): string {
  const buttons = QUICK_ACTIONS.map(
    (q) =>
      `<button type="button" class="btn btn-secondary btn-sm ai-quick-action" data-quick-action="${q.action}">${escapeHtml(q.label)}</button>`,
  ).join("");
  return `<div class="ai-section">
        <div class="ai-section-title">Quick Actions</div>
        <div class="ai-quick-actions" role="group" aria-label="AI quick actions">${buttons}</div>
      </div>`;
}

function renderContextChips(): string {
  const chips = CONTEXT_CHIPS.map(
    (c) =>
      `<button type="button" class="ai-context-chip" data-context-key="${c.key}" title="Show the current value">${escapeHtml(c.label)}</button>`,
  ).join("");
  return `<div class="ai-section">
        <div class="ai-section-title">Available Context</div>
        <div class="ai-context-chips">${chips}</div>
        <div id="ai-context-preview" class="ai-context-preview" hidden></div>
      </div>`;
}

function renderSelect(
  id: string,
  name: string,
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
): string {
  const opts = options
    .map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
    .join("");
  return `<div class="form-group">
        <label for="${id}" class="form-label">${escapeHtml(label)}</label>
        <select id="${id}" name="${name}" class="form-select">${opts}</select>
      </div>`;
}

export function renderAIAssistantPanel(): string {
  const textModels = escapeHtml(SUPPORTED_TEXT_MODELS.join(", "));
  const imageModels = escapeHtml(SUPPORTED_IMAGE_MODELS.join(", "));
  return `<section class="ai-assistant-panel" id="ai-assistant-panel">
  <div class="card">
    <button type="button" class="ai-panel-header" id="ai-panel-toggle" aria-expanded="true" aria-controls="ai-panel-body">
      <span class="ai-panel-title">AI Assistant</span>
      <span class="ai-panel-chevron" aria-hidden="true">&#9662;</span>
    </button>
    <div class="ai-panel-body" id="ai-panel-body">
      ${renderQuickActions()}
      <div class="ai-section">
        <div class="ai-section-title">Use Preset</div>
        <select id="ai-preset-select" class="form-select ai-preset-select" aria-label="AI preset">
          <option value="">Select a preset&hellip;</option>
        </select>
      </div>
      <div class="ai-section" id="ai-variables-section" hidden>
        <div class="ai-section-title">Variables</div>
        <div class="ai-preset-variables" id="ai-preset-variables" aria-label="Preset variables"></div>
        <p class="ai-required-warning" id="ai-required-warning" hidden role="alert"></p>
      </div>
      ${renderContextChips()}
      <div class="ai-image-prompts" id="ai-image-prompts" aria-label="Image prompts" hidden></div>
      <div class="ai-section">
        <div class="ai-section-title">Options</div>
        <div class="ai-controls">
          ${renderSelect("ai-tone", "ai_tone", "Tone", TONE_OPTIONS)}
          ${renderSelect("ai-length", "ai_length", "Length", LENGTH_OPTIONS)}
        </div>
      </div>
      <div class="ai-section ai-preview-section" id="ai-preview-section" hidden>
        <button type="button" class="ai-section-title ai-preview-toggle" id="ai-preview-toggle" aria-expanded="false">
          <span>Prompt Preview</span>
          <span class="ai-panel-chevron" aria-hidden="true">&#9662;</span>
        </button>
        <div class="ai-preview-body" id="ai-preview-body" hidden>
          <div class="ai-prompt-block" id="ai-system-block" hidden>
            <div class="ai-prompt-label"><span>System prompt</span>
              <button type="button" class="ai-edit-voice-btn" id="ai-edit-voice">Edit voice</button>
            </div>
            <div class="ai-prompt-text ai-system-preview" id="ai-system-text"></div>
            <textarea id="ai-system-prompt" class="form-textarea ai-system-prompt" rows="3" hidden aria-label="Edited system prompt"></textarea>
          </div>
          <div class="ai-prompt-block">
            <div class="ai-prompt-label"><span>User prompt</span></div>
            <div class="ai-prompt-text ai-preset-preview" id="ai-preset-preview" aria-live="polite"></div>
          </div>
          <p class="ai-unresolved-warning" id="ai-unresolved-warning" hidden></p>
        </div>
      </div>
      <div class="form-group">
        <label for="ai-prompt" class="form-label">Instructions <span class="ai-field-note">(optional)</span></label>
        <textarea id="ai-prompt" class="form-textarea" rows="2" placeholder="Anything specific to add&hellip;"></textarea>
      </div>
      <div class="ai-models">
        <span>Text model: <code>${textModels}</code></span>
        <span>Image model: <code>${imageModels}</code></span>
      </div>
      <div class="ai-panel-actions">
        <button type="button" id="ai-generate-btn" class="btn btn-primary">&#10024; Generate</button>
      </div>
      <div class="ai-loading" id="ai-loading" hidden>
        <span class="ai-loading-spinner" aria-hidden="true"></span>
        <span>Generating&hellip;</span>
      </div>
      <p id="ai-panel-status" class="ai-panel-status" role="status" aria-live="polite"></p>
      <p id="ai-panel-error" class="alert alert-error" hidden role="alert"></p>
      <div class="ai-results" id="ai-results" hidden>
        <div class="ai-section-title"><span>Result</span>
          <button type="button" id="ai-clear-btn" class="btn btn-secondary btn-sm ai-clear-btn">Clear</button>
        </div>
        <div class="ai-result" id="ai-result"></div>
        <div class="ai-result-actions">
          <button type="button" id="ai-copy-btn" class="btn btn-secondary btn-sm">Copy</button>
          <button type="button" id="ai-insert-btn" class="btn btn-primary btn-sm">Insert into editor</button>
        </div>
      </div>
    </div>
  </div>
</section>`;
}

export const aiAssistantStyles = `
.ai-assistant-panel{margin-top:16px}
.ai-panel-header{display:flex;width:100%;align-items:center;justify-content:space-between;background:none;border:0;padding:0;cursor:pointer;font:inherit}
.ai-panel-title{font-weight:600}
.ai-panel-chevron{color:var(--color-text-muted,#6b7280)}
.ai-panel-body{margin-top:12px}
.ai-section{margin:0 0 14px}
.ai-section-title{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--color-text-muted,#6b7280);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.ai-quick-actions{display:flex;flex-wrap:wrap;gap:8px}
.ai-quick-action.active{background:var(--color-primary,#2563eb);color:#fff;border-color:var(--color-primary,#2563eb)}
.ai-preset-variables{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.ai-var-chip{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--color-text-muted,#6b7280)}
.ai-var-name{font-family:monospace}
.ai-var-required{color:var(--color-error,#ef4444)}
.ai-variable-input.ai-input-missing{border-color:var(--color-error,#ef4444)}
.ai-required-warning,.ai-unresolved-warning{display:flex;gap:6px;align-items:center;font-size:12px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:6px 10px;margin:8px 0 0}
.ai-context-chips{display:flex;flex-wrap:wrap;gap:6px}
.ai-context-chip{background:var(--color-bg-alt,#f9fafb);border:1px solid var(--color-border,#e5e7eb);border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer;font:inherit}
.ai-context-chip:hover{border-color:var(--color-primary,#2563eb)}
.ai-context-preview{margin-top:8px;font-size:12px;background:var(--color-bg-alt,#f9fafb);border:1px solid var(--color-border,#e5e7eb);border-radius:6px;padding:8px 10px;white-space:pre-wrap;word-break:break-word}
.ai-image-prompts{display:flex;flex-direction:column;gap:8px;margin:8px 0 14px;padding:10px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;background:var(--color-bg-alt,#f9fafb)}
.ai-controls{display:flex;gap:12px}
.ai-controls .form-group{flex:1;margin-bottom:0}
.ai-preview-toggle{width:100%;background:none;border:0;padding:0;cursor:pointer;font:inherit;text-align:left}
.ai-preview-body{margin-top:8px;display:flex;flex-direction:column;gap:10px}
.ai-prompt-block{display:flex;flex-direction:column;gap:4px}
.ai-prompt-label{font-size:12px;font-weight:600;color:var(--color-text-muted,#6b7280);display:flex;align-items:center;justify-content:space-between}
.ai-edit-voice-btn{background:none;border:1px solid var(--color-border,#e5e7eb);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--color-primary,#2563eb)}
.ai-prompt-text{white-space:pre-wrap;word-break:break-word;background:var(--color-bg-alt,#f6f7f9);padding:8px 10px;border-radius:6px;font-size:12px;min-height:1.5em}
.prompt-variable{background:#dcfce7;border-radius:3px;padding:0 2px}
.prompt-variable-unresolved{background:#fee2e2;border-radius:3px;padding:0 2px;font-family:monospace}
.ai-system-prompt{font-family:ui-monospace,monospace;font-size:12px}
.ai-field-note{font-weight:400;color:var(--color-text-muted,#6b7280);font-size:12px}
.ai-models{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--color-text-muted,#6b7280);margin:0 0 12px}
.ai-panel-actions{display:flex;gap:8px}
.ai-loading{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-text-muted,#6b7280);margin-top:8px}
.ai-loading-spinner{width:14px;height:14px;border:2px solid var(--color-border,#e5e7eb);border-top-color:var(--color-primary,#2563eb);border-radius:50%;animation:ai-spin .8s linear infinite;display:inline-block}
@keyframes ai-spin{to{transform:rotate(360deg)}}
.ai-panel-status{font-size:13px;color:var(--color-text-muted,#6b7280);min-height:1em;margin:8px 0 0}
.ai-clear-btn{text-transform:none;letter-spacing:0}
.ai-results{margin-top:12px}
.ai-result-text{white-space:pre-wrap;word-break:break-word;background:var(--color-bg-alt,#f6f7f9);padding:10px 12px;border-radius:6px;font-size:13px;margin:0 0 8px}
.ai-result-image{max-width:100%;border-radius:6px;display:block;margin:0 0 8px}
.ai-result-actions{display:flex;gap:8px}
`;
