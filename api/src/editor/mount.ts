// Shared block-editor mount helper (DRY: extracted from the verbatim copies
// previously duplicated in admin/templates/articles.ts + admin/templates/pages.ts).
//
// All three exports render the EXACT bytes both forms emitted before the
// extraction — this is a pure refactor, NO output change:
//   - BLOCK_EDITOR_COLOR_TOKENS : the :root{--color-*} token block (styles).
//   - blockEditorMountScript()  : the ES5 IIFE that boots window.initBlockEditor
//     onto the empty #content-editor div, syncing the hidden textarea#content_json.
//   - renderBlockEditorField()  : the empty #content-editor mount + hidden
//     textarea#content_json field markup.
//
// The mount script is ES5-only inside the <script> string (var/function, no
// arrow/const/let). The placeholder is injected via JSON.stringify so it stays
// a valid ES5 double-quoted string literal in the emitted script.

import { escapeHtml } from "./sanitize";

export const BLOCK_EDITOR_COLOR_TOKENS = `
:root{--color-bg:#ffffff;--color-bg-alt:#f9fafb;--color-bg-dark:#f3f4f6;--color-border:#e5e7eb;--color-text:#111827;--color-text-muted:#6b7280;--color-primary:#2563eb;--color-primary-light:#dbeafe;--color-primary-dark:#1d4ed8;--color-error:#ef4444;--color-success:#10b981;--color-warning:#f59e0b;}
`;

export function blockEditorMountScript(placeholder: string): string {
  return `
(function(){window._inlineAIImagePresets=window._inlineAIImagePresets||[];function boot(){if(window.initBlockEditor){window.initBlockEditor("content-editor",{hiddenInputId:"content_json",placeholder:${JSON.stringify(placeholder)}});}}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",boot);}else{boot();}}());
`;
}

export function renderBlockEditorField(contentJson: string | undefined, placeholder?: string): string {
  void placeholder;
  const jsonVal = escapeHtml(contentJson ?? "");
  return `<div class="form-group">
      <label for="content-editor" class="form-label">Content</label>
      <div id="content-editor"></div>
      <textarea id="content_json" name="content_json" class="content-json-input" hidden aria-hidden="true">${jsonVal}</textarea>
    </div>`;
}
