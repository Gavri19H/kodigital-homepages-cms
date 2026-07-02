// Admin AI Assistant panel inline script (T14 full legacy port of the
// renderAIAssistantPanel script from the legacy admin articles template,
// legacy reference READ-ONLY).
//
// What this script wires (T14.AC1 behavioral contract):
//   - the four quick-action handlers (outline, draft, rewrite, seo_meta),
//     each building a task prompt from the tone/length controls + the
//     article fields and firing POST /api/admin/ai/chat;
//   - the preset selector (ai-preset-select): on change it auto-detects the
//     {{token}} variables in the preset prompt, renders an input chip per
//     variable, and shows a live interpolated prompt-preview;
//   - the tone and length controls feed the quick-action prompts;
//   - the ai-results wiring parses a structured JSON reply and auto-fills the
//     article form's title / excerpt / meta (seo description) / author fields.
//
// HARD CONTRACT (T28.AC4 + T14.AC1): this is an ES5-only string — no arrow
// functions, no block-scoped declarations, no template literals INSIDE the
// script string. Module-level TypeScript may use ES6; the LITERAL may not.
// Regex backslashes are DOUBLE-escaped because the export is a template
// literal (es5-inline-scripts rule): `\\{` emits `\{` etc.
//
// Endpoint contract (this repo, NOT the legacy generate-* routes):
//   GET  /api/admin/ai/presets?active_only=true  — populate the preset select
//   POST /api/admin/ai/chat   {prompt, site_id?} -> {ok, model, text, ...}
//   POST /api/admin/ai/image  {prompt, site_id?} -> {ok, model, image_url, ...}
// Insert-to-editor goes through window.blockEditor.addBlock (the T27 block
// editor's programmatic hook).

export const aiAssistantScripts = `
(function () {
  var panel = document.getElementById('ai-assistant-panel');
  if (!panel) { return; }
  var TOKEN_RE = /\\{\\{\\s*([\\w.\\-]+)\\s*\\}\\}/g;
  var toggleBtn = document.getElementById('ai-panel-toggle');
  var body = document.getElementById('ai-panel-body');
  var presetSelect = document.getElementById('ai-preset-select');
  var presetVars = document.getElementById('ai-preset-variables');
  var presetPreview = document.getElementById('ai-preset-preview');
  var systemPreview = document.getElementById('ai-system-preview');
  var toneEl = document.getElementById('ai-tone');
  var lengthEl = document.getElementById('ai-length');
  var promptEl = document.getElementById('ai-prompt');
  var chatBtn = document.getElementById('ai-chat-btn');
  var imageBtn = document.getElementById('ai-image-btn');
  var statusEl = document.getElementById('ai-panel-status');
  var errEl = document.getElementById('ai-panel-error');
  var resultSection = document.getElementById('ai-results');
  var resultEl = document.getElementById('ai-result');
  var copyBtn = document.getElementById('ai-copy-btn');
  var insertBtn = document.getElementById('ai-insert-btn');
  var presetsById = {};
  var activePreset = null;
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
    var qa = panel.querySelectorAll('.ai-quick-action');
    var k;
    for (k = 0; k < qa.length; k++) { qa[k].disabled = busy; }
    setStatus(busy ? 'Generating\\u2026' : '');
  }
  function readSiteId() {
    var el = document.querySelector('select[name="site_id"], input[name="site_id"]');
    return el && el.value ? el.value : null;
  }
  function fieldValue(selector) {
    var el = document.querySelector(selector);
    return el && typeof el.value === 'string' ? el.value : '';
  }
  function fillField(selector, value) {
    if (value === null || value === undefined) { return false; }
    var el = document.querySelector(selector);
    if (!el) { return false; }
    el.value = String(value);
    if (typeof Event === 'function') {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  if (toggleBtn && body) {
    toggleBtn.addEventListener('click', function () {
      var open = !body.hidden;
      body.hidden = open;
      toggleBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }

  // ---- Preset selector: variables + live interpolated prompt preview ----
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
        opt.textContent = list[j].name || list[j].slug;
        og.appendChild(opt);
      }
      presetSelect.appendChild(og);
    }
  }
  function presetTemplate(preset) {
    var sys = preset && preset.system_prompt_template ? preset.system_prompt_template : '';
    var usr = preset && preset.user_prompt_template ? preset.user_prompt_template : '';
    var base = usr || (preset && preset.prompt_template ? preset.prompt_template : '');
    if (sys) { return sys + '\\n\\n' + base; }
    return base;
  }
  // Token auto-detect via replace-callback (no stateful matcher loop).
  function detectTokens(tpl) {
    var names = [];
    var seen = {};
    String(tpl).replace(TOKEN_RE, function (whole, name) {
      if (!seen[name]) { seen[name] = true; names.push(name); }
      return whole;
    });
    return names;
  }
  function declaredVariables(preset) {
    var out = [];
    if (!preset || !preset.variables) { return out; }
    var parsed;
    try { parsed = JSON.parse(preset.variables); } catch (e) { return out; }
    if (!parsed || !parsed.length) { return out; }
    var i, v, name;
    for (i = 0; i < parsed.length; i++) {
      v = parsed[i];
      name = typeof v === 'string' ? v : (v && (v.name || v.key));
      if (name) { out.push(String(name)); }
    }
    return out;
  }
  function variableValues() {
    var values = {};
    if (!presetVars) { return values; }
    var inputs = presetVars.querySelectorAll('[data-var-name]');
    var i, el;
    for (i = 0; i < inputs.length; i++) {
      el = inputs[i];
      values[el.getAttribute('data-var-name')] = el.value;
    }
    return values;
  }
  function interpolate(tpl, values) {
    return String(tpl).replace(TOKEN_RE, function (whole, name) {
      return (values && values[name] !== undefined && values[name] !== '') ? values[name] : whole;
    });
  }
  // T7/AC2: a dedicated system-prompt preview that updates on preset select
  // (and on every variable edit). It shows the interpolated
  // system_prompt_template the server will apply, so the operator sees the
  // voice the preset overrides the tone with.
  function renderSystemPreview() {
    if (!systemPreview) { return; }
    if (!activePreset || !activePreset.system_prompt_template) {
      systemPreview.textContent = '';
      return;
    }
    systemPreview.textContent = interpolate(activePreset.system_prompt_template, variableValues());
  }
  function renderPreview() {
    renderSystemPreview();
    if (!presetPreview) { return; }
    if (!activePreset) { presetPreview.textContent = ''; return; }
    var prompt = interpolate(presetTemplate(activePreset), variableValues());
    presetPreview.textContent = prompt;
    if (promptEl) { promptEl.value = prompt; }
  }
  function renderVariableInputs(preset) {
    if (!presetVars) { return; }
    while (presetVars.firstChild) { presetVars.removeChild(presetVars.firstChild); }
    if (!preset) { return; }
    var names = detectTokens(presetTemplate(preset));
    var declared = declaredVariables(preset);
    var i, n, wrap, span, input;
    for (i = 0; i < declared.length; i++) {
      if (names.indexOf(declared[i]) === -1) { names.push(declared[i]); }
    }
    for (i = 0; i < names.length; i++) {
      n = names[i];
      wrap = document.createElement('label');
      wrap.className = 'ai-var-chip';
      span = document.createElement('span');
      span.className = 'ai-var-name';
      span.textContent = '{{' + n + '}}';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input ai-var-input';
      input.setAttribute('data-var-name', n);
      input.placeholder = n;
      input.addEventListener('input', renderPreview);
      wrap.appendChild(span);
      wrap.appendChild(input);
      presetVars.appendChild(wrap);
    }
  }
  if (presetSelect) {
    fetch('/api/admin/ai/presets?active_only=true&per_page=200', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { if (json && json.items) { populatePresets(json.items); } })
      .catch(function () { setStatus('Presets unavailable'); });
    presetSelect.addEventListener('change', function () {
      activePreset = presetsById[presetSelect.value] || null;
      renderVariableInputs(activePreset);
      renderPreview();
      if (activePreset) { setStatus('Preset loaded: ' + (activePreset.name || activePreset.slug)); }
    });
  }

  // ---- Quick actions: outline / draft / rewrite / seo_meta ----
  function buildQuickPrompt(action) {
    var title = fieldValue('#article-title');
    var excerpt = fieldValue('#article-excerpt');
    var content = fieldValue('#article-content');
    var tone = toneEl && toneEl.value ? toneEl.value : 'professional';
    var length = lengthEl && lengthEl.value ? lengthEl.value : 'medium';
    if (action === 'outline') {
      return 'Create a structured outline (section headings and bullet points) for an article titled "' + title + '". Tone: ' + tone + '. Target length: ' + length + '.';
    }
    if (action === 'draft') {
      return 'Write a complete, ' + length + '-length article in a ' + tone + ' tone titled "' + title + '". Respond ONLY with a JSON object with the keys "title", "excerpt", "meta_description" and "content".';
    }
    if (action === 'rewrite') {
      return 'Rewrite the following article content in a ' + tone + ' tone at ' + length + ' length, preserving the meaning. Content: ' + content;
    }
    if (action === 'seo_meta') {
      return 'Generate an SEO title and meta description for an article titled "' + title + '" (excerpt: "' + excerpt + '"). Respond ONLY with a JSON object with the keys "seo_title" and "meta_description".';
    }
    if (action === 'faq') {
      return 'Write 3 to 5 frequently asked questions with concise, helpful answers for an article titled "' + title + '" in a ' + tone + ' tone. Respond ONLY with a JSON object of the shape { "faqs": [{ "question": "...", "answer": "..." }] }.';
    }
    if (action === 'key_idea') {
      return 'Write one short, punchy "key idea" pull-quote (a single sentence, no attribution) that captures the core takeaway of an article titled "' + title + '" in a ' + tone + ' tone. Respond ONLY with a JSON object of the shape { "key_idea": "..." }.';
    }
    return '';
  }

  // ---- Structured auto-fill of title / excerpt / meta / author ----
  function extractStructured(text) {
    if (typeof text !== 'string') { return null; }
    var first = text.indexOf('{');
    var last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last < first) { return null; }
    var obj;
    try { obj = JSON.parse(text.slice(first, last + 1)); } catch (e) { return null; }
    return (obj && typeof obj === 'object') ? obj : null;
  }
  function insertContent(text) {
    var editor = window.blockEditor || null;
    if (editor && typeof editor.addBlock === 'function') {
      editor.addBlock('paragraph', { text: text });
      return;
    }
    var ta = document.getElementById('article-content');
    if (ta) { ta.value = ta.value ? (ta.value + '\\n\\n' + text) : text; }
  }
  function applyStructured(obj) {
    var filled = [];
    if (fillField('#article-title', obj.title)) { filled.push('title'); }
    if (fillField('#article-excerpt', obj.excerpt)) { filled.push('excerpt'); }
    var meta = obj.meta_description !== undefined ? obj.meta_description : obj.meta;
    if (fillField('#article-seo-description', meta)) { filled.push('meta'); }
    if (fillField('#article-seo-title', obj.seo_title)) { filled.push('seo title'); }
    var author = obj.author_name !== undefined ? obj.author_name : obj.author;
    if (fillField('[name="author_name"]', author)) { filled.push('author'); }
    if (obj.author_bio !== undefined) { fillField('[name="author_bio"]', obj.author_bio); }
    if (obj.content !== undefined && obj.content !== null) { insertContent(String(obj.content)); }
    // PR-3 (issue 12): structured FAQ + Key-idea inserts. faqs[] becomes ONE
    // faqgroup block (round-trips into the friendly FAQ editor and expands to
    // the public .faq-section); key_idea becomes a pullquote block. Both go
    // through the editor's addBlock; if the editor is absent they degrade to
    // appended plain text in the content textarea.
    if (insertFaqs(obj.faqs)) { filled.push('faqs'); }
    if (insertKeyIdea(obj.key_idea)) { filled.push('key idea'); }
    return filled;
  }

  function insertFaqs(faqs) {
    if (!faqs || Object.prototype.toString.call(faqs) !== '[object Array]') { return false; }
    var items = [];
    var i;
    for (i = 0; i < faqs.length; i++) {
      var f = faqs[i];
      if (!f || typeof f !== 'object') { continue; }
      var q = f.question !== undefined ? f.question : f.q;
      var a = f.answer !== undefined ? f.answer : f.a;
      q = q == null ? '' : String(q);
      a = a == null ? '' : String(a);
      if (q === '' && a === '') { continue; }
      items.push({ q: q, a: a });
    }
    if (items.length === 0) { return false; }
    var editor = window.blockEditor || null;
    if (editor && typeof editor.addBlock === 'function') {
      editor.addBlock('faqgroup', { items: items });
      return true;
    }
    var ta = document.getElementById('article-content');
    if (ta) {
      var lines = [];
      for (i = 0; i < items.length; i++) { lines.push('Q: ' + items[i].q + '\\nA: ' + items[i].a); }
      var text = lines.join('\\n\\n');
      ta.value = ta.value ? (ta.value + '\\n\\n' + text) : text;
    }
    return true;
  }

  function insertKeyIdea(keyIdea) {
    if (keyIdea == null) { return false; }
    var text = String(keyIdea).trim();
    if (text === '') { return false; }
    var editor = window.blockEditor || null;
    if (editor && typeof editor.addBlock === 'function') {
      editor.addBlock('pullquote', { text: text });
      return true;
    }
    var ta = document.getElementById('article-content');
    if (ta) { ta.value = ta.value ? (ta.value + '\\n\\n' + text) : text; }
    return true;
  }

  function generate(url, kind, action) {
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
    // T7/AC2: send the tone/length options and, when a preset is selected, the
    // presetId + its {{variable}} values so the server applies the preset
    // system_prompt_template, overrides the tone, and maps length->max_tokens.
    payload.options = {
      tone: toneEl && toneEl.value ? toneEl.value : '',
      length: lengthEl && lengthEl.value ? lengthEl.value : ''
    };
    if (activePreset) {
      payload.presetId = activePreset.id;
      payload.variables = variableValues();
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (json) { return { ok: res.ok, status: res.status, body: json }; });
    }).then(function (res) {
      setBusy(false);
      if (!res.ok) {
        setError((res.body && res.body.error) || ('AI request failed (HTTP ' + res.status + ')'));
        return;
      }
      showResult(kind, res.body, action);
    }).catch(function () {
      setBusy(false);
      setError('Network error');
    });
  }
  if (chatBtn) {
    chatBtn.addEventListener('click', function () { generate('/api/admin/ai/chat', 'text', null); });
  }
  if (imageBtn) {
    imageBtn.addEventListener('click', function () { generate('/api/admin/ai/image', 'image', null); });
  }

  function onQuickClick() {
    var action = this.getAttribute('data-quick-action');
    if (promptEl) { promptEl.value = buildQuickPrompt(action); }
    generate('/api/admin/ai/chat', 'text', action);
  }
  var quickButtons = panel.querySelectorAll('.ai-quick-action');
  var qi;
  for (qi = 0; qi < quickButtons.length; qi++) {
    quickButtons[qi].addEventListener('click', onQuickClick);
  }

  function showResult(kind, data, action) {
    lastResult = { kind: kind, data: data };
    while (resultEl.firstChild) { resultEl.removeChild(resultEl.firstChild); }
    var autoFilled = null;
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
      var structured = extractStructured(data.text || '');
      if (structured) {
        autoFilled = applyStructured(structured);
      } else if (action === 'outline' || action === 'rewrite') {
        insertContent(data.text || '');
      }
    }
    resultSection.hidden = false;
    if (autoFilled && autoFilled.length) {
      setStatus('Auto-filled: ' + autoFilled.join(', '));
    } else {
      setStatus('Done (model: ' + (data.model || 'unknown') + ')');
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!lastResult) { return; }
      var text = lastResult.kind === 'image' ? (lastResult.data.image_url || '') : (lastResult.data.text || '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { setStatus('Copied'); }).catch(function () { setStatus('Copy failed'); });
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
