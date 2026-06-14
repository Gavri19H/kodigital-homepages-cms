// Admin AI Assistant panel (T28 [B8] port of the legacy
// renderAIAssistantPanel / aiAssistantStyles / aiAssistantScripts trio from
// the legacy admin articles template, legacy reference READ-ONLY).
//
// Endpoint contract (this repo, NOT the legacy generate-* routes):
//   GET  /api/admin/ai/presets?active_only=true  — populate the preset select
//   POST /api/admin/ai/chat   {prompt, site_id?} -> {ok, model, text, ...}
//   POST /api/admin/ai/image  {prompt, site_id?} -> {ok, model, media_id,
//                                                    image_url, ...}
//
// Models shown in the panel come ONLY from the SUPPORTED_*_MODELS registry
// lists (../../ai/models) — never hardcoded model id literals (T28.AC2).
//
// HARD CONTRACT (T28.AC4): aiAssistantScripts is ES5-only — no arrow
// functions, no block-scoped declarations, no template literals inside the
// script string. Module-level TypeScript may use ES6; the LITERAL may not.
// Insert-to-editor goes through window.blockEditor.addBlock (the T27 block
// editor's programmatic hook); text results land as paragraph blocks and
// image results as image blocks with src/media_id.

import { SUPPORTED_IMAGE_MODELS, SUPPORTED_TEXT_MODELS } from "../../ai/models";
import { escapeHtml } from "./layout";

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
      <div class="form-group">
        <label for="ai-preset-select" class="form-label">Preset</label>
        <select id="ai-preset-select" class="form-select ai-preset-select" aria-label="AI preset">
          <option value="">Select a preset&hellip;</option>
        </select>
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
      <div class="ai-result-section" id="ai-result-section" hidden>
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
.ai-models{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--c-muted);margin-bottom:12px}
.ai-panel-actions{display:flex;gap:8px}
.ai-panel-status{font-size:13px;color:var(--c-muted);min-height:1em;margin:8px 0 0}
.ai-result-section{margin-top:12px}
.ai-result-text{white-space:pre-wrap;word-break:break-word;background:var(--c-bg, #f6f7f9);padding:10px 12px;border-radius:6px;font-size:13px;margin:0 0 8px}
.ai-result-image{max-width:100%;border-radius:6px;display:block;margin:0 0 8px}
.ai-result-actions{display:flex;gap:8px}
`;

// ES5 only (var, function, .then(), string concat — no template literals).
export const aiAssistantScripts = `
(function () {
  var panel = document.getElementById('ai-assistant-panel');
  if (!panel) { return; }
  var toggleBtn = document.getElementById('ai-panel-toggle');
  var body = document.getElementById('ai-panel-body');
  var presetSelect = document.getElementById('ai-preset-select');
  var promptEl = document.getElementById('ai-prompt');
  var chatBtn = document.getElementById('ai-chat-btn');
  var imageBtn = document.getElementById('ai-image-btn');
  var statusEl = document.getElementById('ai-panel-status');
  var errEl = document.getElementById('ai-panel-error');
  var resultSection = document.getElementById('ai-result-section');
  var resultEl = document.getElementById('ai-result');
  var copyBtn = document.getElementById('ai-copy-btn');
  var insertBtn = document.getElementById('ai-insert-btn');
  var presetsById = {};
  var lastResult = null;

  function setStatus(msg) {
    if (!statusEl) { return; }
    while (statusEl.firstChild) { statusEl.removeChild(statusEl.firstChild); }
    if (msg) { statusEl.appendChild(document.createTextNode(msg)); }
  }
  function setError(msg) {
    if (!errEl) { return; }
    errEl.hidden = !msg;
    errEl.textContent = msg || '';
  }
  function setBusy(busy) {
    if (chatBtn) { chatBtn.disabled = busy; }
    if (imageBtn) { imageBtn.disabled = busy; }
    setStatus(busy ? 'Generating\\u2026' : '');
  }
  function readSiteId() {
    var el = document.querySelector('select[name="site_id"], input[name="site_id"]');
    return el && el.value ? el.value : null;
  }

  if (toggleBtn && body) {
    toggleBtn.addEventListener('click', function () {
      var open = !body.hidden;
      body.hidden = open;
      toggleBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }

  function groupLabel(category) {
    if (category === 'content' || category === 'outline') { return 'Content'; }
    if (category === 'seo') { return 'SEO'; }
    if (category === 'image') { return 'Images'; }
    return 'Other';
  }

  function populatePresets(rows) {
    var groups = {};
    var order = ['Content', 'SEO', 'Images', 'Other'];
    var i, j, row, label, og, opt, list;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row || !row.is_active) { continue; }
      presetsById[String(row.id)] = row;
      label = groupLabel(row.category);
      if (!groups[label]) { groups[label] = []; }
      groups[label].push(row);
    }
    for (i = 0; i < order.length; i++) {
      list = groups[order[i]];
      if (!list || !list.length) { continue; }
      og = document.createElement('optgroup');
      og.label = order[i];
      for (j = 0; j < list.length; j++) {
        opt = document.createElement('option');
        opt.value = String(list[j].id);
        opt.textContent = list[j].slug;
        og.appendChild(opt);
      }
      presetSelect.appendChild(og);
    }
  }

  if (presetSelect) {
    fetch('/api/admin/ai/presets?active_only=true&per_page=200', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json && json.items) { populatePresets(json.items); }
      })
      .catch(function () { setStatus('Presets unavailable'); });

    presetSelect.addEventListener('change', function () {
      var row = presetsById[presetSelect.value];
      if (row && row.prompt_template && promptEl) {
        promptEl.value = row.prompt_template;
        setStatus('Preset loaded: ' + row.slug);
      }
    });
  }

  function generate(url, kind) {
    var text = promptEl && promptEl.value ? promptEl.value.trim() : '';
    if (!text) {
      setError('Prompt is required');
      if (promptEl) { promptEl.focus(); }
      return;
    }
    setError('');
    setBusy(true);
    var payload = { prompt: text };
    var siteId = readSiteId();
    if (siteId) { payload.site_id = siteId; }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, body: json };
      });
    }).then(function (res) {
      setBusy(false);
      if (!res.ok) {
        setError((res.body && res.body.error) || ('AI request failed (HTTP ' + res.status + ')'));
        return;
      }
      showResult(kind, res.body);
    }).catch(function () {
      setBusy(false);
      setError('Network error');
    });
  }
  if (chatBtn) {
    chatBtn.addEventListener('click', function () { generate('/api/admin/ai/chat', 'text'); });
  }
  if (imageBtn) {
    imageBtn.addEventListener('click', function () { generate('/api/admin/ai/image', 'image'); });
  }

  function showResult(kind, data) {
    lastResult = { kind: kind, data: data };
    while (resultEl.firstChild) { resultEl.removeChild(resultEl.firstChild); }
    if (kind === 'image' && data.image_url) {
      var img = document.createElement('img');
      img.src = data.image_url;
      img.alt = promptEl && promptEl.value ? promptEl.value : 'AI generated image';
      img.className = 'ai-result-image';
      resultEl.appendChild(img);
    } else {
      var pre = document.createElement('pre');
      pre.className = 'ai-result-text';
      pre.appendChild(document.createTextNode(data.text || ''));
      resultEl.appendChild(pre);
    }
    resultSection.hidden = false;
    setStatus('Done (model: ' + (data.model || 'unknown') + ')');
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!lastResult) { return; }
      var text = lastResult.kind === 'image'
        ? (lastResult.data.image_url || '')
        : (lastResult.data.text || '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          setStatus('Copied');
        }).catch(function () { setStatus('Copy failed'); });
      } else {
        setStatus('Clipboard unavailable');
      }
    });
  }

  if (insertBtn) {
    insertBtn.addEventListener('click', function () {
      if (!lastResult) { return; }
      var editor = window.blockEditor || null;
      if (!editor) { setError('Editor is not mounted'); return; }
      if (lastResult.kind === 'image') {
        editor.addBlock('image', {
          src: lastResult.data.image_url || '',
          media_id: lastResult.data.media_id || null,
          alt: promptEl && promptEl.value ? promptEl.value : ''
        });
      } else {
        editor.addBlock('paragraph', { text: lastResult.data.text || '' });
      }
      setStatus('Inserted into editor');
    });
  }
}());
`;
