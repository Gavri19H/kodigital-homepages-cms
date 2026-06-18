// Admin AI Assistant panel (T14 full legacy port of the
// renderAIAssistantPanel / aiAssistantStyles / aiAssistantScripts trio from
// the legacy admin articles template, legacy reference READ-ONLY).
//
// T14 ports the FULL legacy panel (not the prior stub): the four quick-action
// buttons (Outline / Draft / Rewrite / SEO Meta), the preset selector with
// auto-detected {{variable}} chips + a live interpolated prompt-preview, the
// tone and length controls, and the ai-results region whose wiring auto-fills
// the article form title / excerpt / meta / author from a structured JSON
// reply. The interactive behaviour lives in aiAssistantScripts (./ai-panel-
// script), re-exported here so callers keep a single ./ai-panel import.
//
// Endpoint contract (this repo, NOT the legacy generate-* routes):
//   GET  /api/admin/ai/presets?active_only=true  — populate the preset select
//   POST /api/admin/ai/chat   {prompt, site_id?} -> {ok, model, text, ...}
//   POST /api/admin/ai/image  {prompt, site_id?} -> {ok, model, image_url, ...}
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
];

const TONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "professional", label: "Professional" },
  { value: "conversational", label: "Conversational" },
  { value: "friendly", label: "Friendly" },
  { value: "authoritative", label: "Authoritative" },
  { value: "informative", label: "Informative" },
];

const LENGTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

function renderQuickActions(): string {
  const buttons = QUICK_ACTIONS.map(
    (q) =>
      `<button type="button" class="btn btn-secondary btn-sm ai-quick-action" data-quick-action="${q.action}">${escapeHtml(q.label)}</button>`,
  ).join("");
  return `<div class="ai-quick-actions" role="group" aria-label="AI quick actions">${buttons}</div>`;
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
      <div class="form-group">
        <label for="ai-preset-select" class="form-label">Preset</label>
        <select id="ai-preset-select" class="form-select ai-preset-select" aria-label="AI preset">
          <option value="">Select a preset&hellip;</option>
        </select>
      </div>
      <div class="ai-preset-variables" id="ai-preset-variables" aria-label="Preset variables"></div>
      <div class="form-group ai-system-preview-group">
        <label for="ai-system-preview" class="form-label">System prompt</label>
        <pre class="ai-preset-preview ai-system-preview" id="ai-system-preview" aria-live="polite"></pre>
      </div>
      <div class="form-group ai-preset-preview-group">
        <label for="ai-preset-preview" class="form-label">Prompt preview</label>
        <pre class="ai-preset-preview" id="ai-preset-preview" aria-live="polite"></pre>
      </div>
      <div class="ai-controls">
        ${renderSelect("ai-tone", "ai_tone", "Tone", TONE_OPTIONS)}
        ${renderSelect("ai-length", "ai_length", "Length", LENGTH_OPTIONS)}
      </div>
      <div class="form-group">
        <label for="ai-prompt" class="form-label">Prompt</label>
        <textarea id="ai-prompt" class="form-textarea" rows="4" placeholder="Ask the assistant&hellip;"></textarea>
      </div>
      <div class="ai-models">
        <span>Text model: <code>${textModels}</code></span>
        <span>Image model: <code>${imageModels}</code></span>
      </div>
      <div class="ai-panel-actions">
        <button type="button" id="ai-chat-btn" class="btn btn-primary btn-sm">Generate text</button>
        <button type="button" id="ai-image-btn" class="btn btn-secondary btn-sm">Generate image</button>
      </div>
      <p id="ai-panel-status" class="ai-panel-status" role="status" aria-live="polite"></p>
      <p id="ai-panel-error" class="alert alert-error" hidden role="alert"></p>
      <div class="ai-results" id="ai-results" hidden>
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
.ai-panel-chevron{color:var(--c-muted)}
.ai-panel-body{margin-top:12px}
.ai-quick-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.ai-preset-variables{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.ai-var-chip{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--c-muted)}
.ai-var-name{font-family:monospace}
.ai-system-preview-group{margin-top:8px}
.ai-preset-preview-group{margin-top:8px}
.ai-preset-preview{white-space:pre-wrap;word-break:break-word;background:var(--c-bg, #f6f7f9);padding:8px 10px;border-radius:6px;font-size:12px;min-height:1.5em;margin:0}
.ai-controls{display:flex;gap:12px}
.ai-controls .form-group{flex:1}
.ai-models{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--c-muted);margin:12px 0}
.ai-panel-actions{display:flex;gap:8px}
.ai-panel-status{font-size:13px;color:var(--c-muted);min-height:1em;margin:8px 0 0}
.ai-results{margin-top:12px}
.ai-result-text{white-space:pre-wrap;word-break:break-word;background:var(--c-bg, #f6f7f9);padding:10px 12px;border-radius:6px;font-size:13px;margin:0 0 8px}
.ai-result-image{max-width:100%;border-radius:6px;display:block;margin:0 0 8px}
.ai-result-actions{display:flex;gap:8px}
`;
