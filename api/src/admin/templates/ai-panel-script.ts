// AI Assistant panel behavior — the LEGACY panel's writer flow restored
// (theiwise-legacy-readonly articles.ts aiAssistantScripts), the richest
// version that ever shipped. The load-bearing legacy behaviors:
//
//   - TWO MODES: a quick action ARMS the panel (highlight, preset cleared,
//     preset sections hidden) OR a preset is selected (action cleared).
//     Generation runs from the single Generate button.
//   - VARIABLES: only the preset's DECLARED variables_schema renders (typed
//     inputs, required stars, defaults); a required-missing warning gates
//     Generate and focuses the first missing input.
//   - AVAILABLE CONTEXT: always-visible chips (Article Title / Category /
//     Excerpt / Selected Text / Site); click previews the live value; the
//     values auto-resolve from the article form into every {{token}}.
//   - RESOLVED PROMPT PREVIEW: collapsible; System + User prompts rendered
//     with resolved values highlighted and unresolved {{tokens}} flagged,
//     plus a warning strip listing them.
//   - Post-mirror additions kept: "Edit voice" (A3 settable system prompt,
//     sent as the server-side override), image-prompt boxes for
//     image-category presets (B3), the empty-completion message (#57), and
//     structured auto-fill incl. faqs/key_idea inserts.
//
// HARD CONTRACT: ES5-only inside the string (var/function, no arrows, no
// const/let, no template literals). Regex/backslash literals are
// double-escaped for the outer template literal.

export const aiAssistantScripts = `
(function () {
  var panel = document.getElementById('ai-assistant-panel');
  if (!panel) { return; }
  var TOKEN_RE = /\\{\\{\\s*([\\w.\\-]+)\\s*\\}\\}/g;
  var toggleBtn = document.getElementById('ai-panel-toggle');
  var body = document.getElementById('ai-panel-body');
  var presetSelect = document.getElementById('ai-preset-select');
  var variablesSection = document.getElementById('ai-variables-section');
  var presetVars = document.getElementById('ai-preset-variables');
  var requiredWarning = document.getElementById('ai-required-warning');
  var contextPreview = document.getElementById('ai-context-preview');
  var previewSection = document.getElementById('ai-preview-section');
  var previewToggle = document.getElementById('ai-preview-toggle');
  var previewBody = document.getElementById('ai-preview-body');
  var systemBlock = document.getElementById('ai-system-block');
  var systemText = document.getElementById('ai-system-text');
  var systemPromptEl = document.getElementById('ai-system-prompt');
  var editVoiceBtn = document.getElementById('ai-edit-voice');
  var presetPreview = document.getElementById('ai-preset-preview');
  var unresolvedWarning = document.getElementById('ai-unresolved-warning');
  var imagePrompts = document.getElementById('ai-image-prompts');
  var toneEl = document.getElementById('ai-tone');
  var lengthEl = document.getElementById('ai-length');
  var promptEl = document.getElementById('ai-prompt');
  var generateBtn = document.getElementById('ai-generate-btn');
  var loadingEl = document.getElementById('ai-loading');
  var statusEl = document.getElementById('ai-panel-status');
  var errEl = document.getElementById('ai-panel-error');
  var resultSection = document.getElementById('ai-results');
  var resultEl = document.getElementById('ai-result');
  var clearBtn = document.getElementById('ai-clear-btn');
  var copyBtn = document.getElementById('ai-copy-btn');
  var insertBtn = document.getElementById('ai-insert-btn');
  var presetsById = {};
  var activePreset = null;
  var activeAction = null;
  var voiceEdited = false;
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
    if (generateBtn) { generateBtn.disabled = busy; }
    if (loadingEl) { loadingEl.hidden = !busy; }
    var qa = panel.querySelectorAll('.ai-quick-action');
    var k;
    for (k = 0; k < qa.length; k++) { qa[k].disabled = busy; }
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

  // ---- Available Context: auto-resolved values from the article form ----
  function getContextValues() {
    var categorySelect = document.querySelector('select[name="category_id"]');
    var categoryName = '';
    if (categorySelect && categorySelect.selectedIndex >= 0) {
      var opt = categorySelect.options[categorySelect.selectedIndex];
      categoryName = opt && opt.value ? opt.text : '';
    }
    var siteSelect = document.querySelector('select[name="site_id"]');
    var brandName = '';
    var vertical = '';
    if (siteSelect && siteSelect.selectedIndex >= 0) {
      var sOpt = siteSelect.options[siteSelect.selectedIndex];
      brandName = sOpt && sOpt.value ? sOpt.text : '';
      vertical = sOpt && sOpt.value ? (sOpt.getAttribute('data-vertical') || '') : '';
    }
    var selectedText = '';
    try { selectedText = String(window.getSelection() || ''); } catch (e) { selectedText = ''; }
    var title = fieldValue('#article-title');
    return {
      article_title: title,
      article_excerpt: fieldValue('#article-excerpt'),
      category_name: categoryName,
      brand_name: brandName,
      vertical: vertical,
      selected_text: selectedText,
      title: title,
      subject: title
    };
  }
  var contextChips = panel.querySelectorAll('.ai-context-chip');
  function onContextChipClick() {
    var key = this.getAttribute('data-context-key');
    var values = getContextValues();
    var value = values[key];
    if (!contextPreview) { return; }
    if (!contextPreview.hidden && contextPreview.getAttribute('data-showing') === key) {
      contextPreview.hidden = true;
      contextPreview.removeAttribute('data-showing');
      return;
    }
    contextPreview.textContent = value && String(value).length > 0
      ? value
      : '(empty right now \\u2014 fill the matching field above)';
    contextPreview.setAttribute('data-showing', key);
    contextPreview.hidden = false;
  }
  var ci;
  for (ci = 0; ci < contextChips.length; ci++) {
    contextChips[ci].addEventListener('click', onContextChipClick);
  }

  // ---- Preset population (grouped select) ----
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

  // ---- Templates, tokens, variables ----
  function presetTemplate(preset) {
    var usr = preset && preset.user_prompt_template ? preset.user_prompt_template : '';
    return usr || (preset && preset.prompt_template ? preset.prompt_template : '');
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
  // The preset's DECLARED variables_schema (key/description/default/required,
  // optional type/rows/placeholder). Legacy behavior: ONLY declared variables
  // render as inputs; undeclared tokens resolve from the article context or
  // show as unresolved in the preview.
  function declaredSchema(preset) {
    var out = [];
    if (!preset) { return out; }
    var raw = preset.variables_schema || preset.variables;
    if (!raw) { return out; }
    var parsed;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return out; }
    if (!parsed || !parsed.length) { return out; }
    var i, v;
    for (i = 0; i < parsed.length; i++) {
      v = parsed[i];
      if (typeof v === 'string') {
        out.push({ key: v, description: '', defaultValue: '', required: false, type: 'text', rows: 3, placeholder: '' });
        continue;
      }
      if (!v || typeof v !== 'object') { continue; }
      var key = v.key || v.name;
      if (!key) { continue; }
      out.push({
        key: String(key),
        description: v.description ? String(v.description) : '',
        defaultValue: v['default'] !== undefined && v['default'] !== null ? String(v['default']) : (v.defaultValue ? String(v.defaultValue) : ''),
        required: v.required === true,
        type: v.type === 'textarea' || v.type === 'number' ? v.type : 'text',
        rows: typeof v.rows === 'number' ? v.rows : 3,
        placeholder: v.placeholder ? String(v.placeholder) : ''
      });
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
  // Combined resolution: declared-variable values win, then the auto context.
  function resolutionValues() {
    var context = getContextValues();
    var custom = variableValues();
    var merged = {};
    var k;
    for (k in context) { if (Object.prototype.hasOwnProperty.call(context, k)) { merged[k] = context[k]; } }
    for (k in custom) {
      if (Object.prototype.hasOwnProperty.call(custom, k) && custom[k] !== '') { merged[k] = custom[k]; }
    }
    return merged;
  }
  function resolveText(tpl) {
    var values = resolutionValues();
    var unresolved = [];
    var resolved = String(tpl).replace(TOKEN_RE, function (whole, name) {
      if (values[name] !== undefined && values[name] !== '') { return values[name]; }
      unresolved.push(name);
      return whole;
    });
    return { resolved: resolved, unresolved: unresolved };
  }

  function renderVariableInputs(preset) {
    if (!presetVars) { return; }
    while (presetVars.firstChild) { presetVars.removeChild(presetVars.firstChild); }
    var schema = declaredSchema(preset);
    if (variablesSection) { variablesSection.hidden = schema.length === 0; }
    if (requiredWarning) { requiredWarning.hidden = true; }
    var i, v, wrap, span, star, input;
    for (i = 0; i < schema.length; i++) {
      v = schema[i];
      wrap = document.createElement('label');
      wrap.className = 'ai-var-chip';
      span = document.createElement('span');
      span.className = 'ai-var-name';
      span.textContent = v.description || v.key;
      if (v.required) {
        star = document.createElement('span');
        star.className = 'ai-var-required';
        star.textContent = ' *';
        span.appendChild(star);
      }
      if (v.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = v.rows;
      } else {
        input = document.createElement('input');
        input.type = v.type === 'number' ? 'number' : 'text';
      }
      input.className = 'form-input ai-var-input ai-variable-input';
      input.setAttribute('data-var-name', v.key);
      if (v.required) { input.setAttribute('data-required', '1'); }
      input.placeholder = v.placeholder || v.key;
      if (v.defaultValue) { input.value = v.defaultValue; }
      input.addEventListener('input', renderPreview);
      wrap.appendChild(span);
      wrap.appendChild(input);
      presetVars.appendChild(wrap);
    }
  }
  function missingRequired() {
    var out = [];
    if (!presetVars) { return out; }
    var inputs = presetVars.querySelectorAll('[data-required="1"]');
    var i;
    for (i = 0; i < inputs.length; i++) {
      if (!inputs[i].value || inputs[i].value.replace(/\\s/g, '') === '') { out.push(inputs[i]); }
    }
    return out;
  }
  function updateRequiredWarning() {
    if (!requiredWarning || !presetVars) { return; }
    var missing = missingRequired();
    var inputs = presetVars.querySelectorAll('.ai-variable-input');
    var i;
    for (i = 0; i < inputs.length; i++) { inputs[i].classList.remove('ai-input-missing'); }
    if (missing.length === 0) { requiredWarning.hidden = true; return; }
    var names = [];
    for (i = 0; i < missing.length; i++) {
      missing[i].classList.add('ai-input-missing');
      names.push(missing[i].getAttribute('data-var-name'));
    }
    requiredWarning.textContent = 'Required: ' + names.join(', ');
    requiredWarning.hidden = false;
  }

  // ---- Resolved prompt preview: highlighted values, flagged tokens ----
  function renderHighlighted(el, tpl) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    var values = resolutionValues();
    var text = String(tpl);
    var lastIndex = 0;
    text.replace(TOKEN_RE, function (whole, name, offset) {
      if (offset > lastIndex) {
        el.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
      }
      var span = document.createElement('span');
      if (values[name] !== undefined && values[name] !== '') {
        span.className = 'prompt-variable';
        span.title = '{{' + name + '}}';
        span.textContent = values[name];
      } else {
        span.className = 'prompt-variable-unresolved';
        span.textContent = whole;
      }
      el.appendChild(span);
      lastIndex = offset + whole.length;
      return whole;
    });
    if (lastIndex < text.length) {
      el.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }
  // T7/AC2: the system-prompt surface renders from system_prompt_template and
  // updates on preset select + every variable/context edit. "Edit voice"
  // (A3 settable system prompt) swaps the preview for an editable textarea
  // prefilled with the RESOLVED voice; the edit rides the next generation.
  function renderSystemPreview() {
    if (!systemBlock) { return; }
    var tpl = activePreset && activePreset.system_prompt_template ? activePreset.system_prompt_template : '';
    if (!tpl) {
      systemBlock.hidden = true;
      return;
    }
    systemBlock.hidden = false;
    if (voiceEdited) {
      if (systemText) { systemText.hidden = true; }
      if (systemPromptEl) { systemPromptEl.hidden = false; }
      return;
    }
    if (systemText) { systemText.hidden = false; }
    if (systemPromptEl) { systemPromptEl.hidden = true; }
    renderHighlighted(systemText, tpl);
  }
  function renderPreview() {
    renderSystemPreview();
    updateRequiredWarning();
    if (!previewSection) { return; }
    if (!activePreset) {
      previewSection.hidden = true;
      return;
    }
    var userTpl = presetTemplate(activePreset);
    previewSection.hidden = false;
    renderHighlighted(presetPreview, userTpl);
    if (unresolvedWarning) {
      var sysTpl = activePreset.system_prompt_template || '';
      var all = resolveText(sysTpl + '\\n' + userTpl).unresolved;
      var uniq = [];
      var seen = {};
      var i;
      for (i = 0; i < all.length; i++) {
        if (!seen[all[i]]) { seen[all[i]] = true; uniq.push('{{' + all[i] + '}}'); }
      }
      if (uniq.length > 0) {
        unresolvedWarning.textContent = 'Unresolved: ' + uniq.join(', ') + ' \\u2014 fill a Variable or the matching article field.';
        unresolvedWarning.hidden = false;
      } else {
        unresolvedWarning.hidden = true;
      }
    }
  }
  if (previewToggle && previewBody) {
    previewToggle.addEventListener('click', function () {
      var open = !previewBody.hidden;
      previewBody.hidden = open;
      previewToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }
  if (editVoiceBtn && systemPromptEl) {
    editVoiceBtn.addEventListener('click', function () {
      if (!voiceEdited) {
        var tpl = activePreset && activePreset.system_prompt_template ? activePreset.system_prompt_template : '';
        systemPromptEl.value = resolveText(tpl).resolved;
        voiceEdited = true;
        editVoiceBtn.textContent = 'Use preset voice';
      } else {
        voiceEdited = false;
        editVoiceBtn.textContent = 'Edit voice';
      }
      renderSystemPreview();
    });
  }
  // Live preview refresh when the article context changes.
  var contextSelectors = ['#article-title', '#article-excerpt', 'select[name="category_id"]', 'select[name="site_id"]'];
  var cs, csEl;
  for (cs = 0; cs < contextSelectors.length; cs++) {
    csEl = document.querySelector(contextSelectors[cs]);
    if (csEl) {
      csEl.addEventListener('input', renderPreview);
      csEl.addEventListener('change', renderPreview);
    }
  }

  // ---- Image prompts (content_mapping.image_prompts) ----
  function imagePromptsOf(preset) {
    if (!preset || !preset.content_mapping) { return null; }
    var map = null;
    try { map = JSON.parse(preset.content_mapping); } catch (err) { return null; }
    if (!map || typeof map !== 'object' || !map.image_prompts || typeof map.image_prompts !== 'object') { return null; }
    var out = [];
    var k;
    for (k in map.image_prompts) {
      if (Object.prototype.hasOwnProperty.call(map.image_prompts, k) &&
          typeof map.image_prompts[k] === 'string' && map.image_prompts[k] !== '') {
        out.push({ key: k, prompt: map.image_prompts[k] });
      }
    }
    return out.length ? out : null;
  }
  function imagePromptLabel(key) {
    if (key === 'hero_image') { return 'Hero image prompt'; }
    if (key === 'above_subheadline_image') { return 'Above-subheadline image prompt'; }
    return key.replace(/_/g, ' ') + ' prompt';
  }
  function renderImagePrompts(preset) {
    if (!imagePrompts) { return; }
    while (imagePrompts.firstChild) { imagePrompts.removeChild(imagePrompts.firstChild); }
    var entries = imagePromptsOf(preset);
    imagePrompts.hidden = !entries;
    if (!entries) { return; }
    var i, wrap, label, ta;
    for (i = 0; i < entries.length; i++) {
      wrap = document.createElement('div');
      wrap.className = 'form-group';
      label = document.createElement('label');
      label.className = 'form-label';
      label.appendChild(document.createTextNode(imagePromptLabel(entries[i].key)));
      ta = document.createElement('textarea');
      ta.className = 'form-textarea ai-image-prompt';
      ta.rows = 2;
      ta.value = resolveText(entries[i].prompt).resolved;
      ta.setAttribute('data-image-key', entries[i].key);
      wrap.appendChild(label);
      wrap.appendChild(ta);
      imagePrompts.appendChild(wrap);
    }
  }

  // ---- Modes: quick action vs preset (legacy semantics) ----
  function clearActionHighlight() {
    var btns = panel.querySelectorAll('.ai-quick-action');
    var i;
    for (i = 0; i < btns.length; i++) { btns[i].classList.remove('active'); }
  }
  function applySelectedPreset() {
    activePreset = presetsById[presetSelect.value] || null;
    activeAction = null;
    voiceEdited = false;
    if (editVoiceBtn) { editVoiceBtn.textContent = 'Edit voice'; }
    clearActionHighlight();
    renderVariableInputs(activePreset);
    renderImagePrompts(activePreset);
    renderPreview();
    if (activePreset) { setStatus('Preset loaded: ' + (activePreset.name || activePreset.slug)); }
    else { setStatus(''); }
  }
  function onQuickClick() {
    var action = this.getAttribute('data-quick-action');
    activeAction = action;
    activePreset = null;
    voiceEdited = false;
    if (presetSelect) { presetSelect.value = ''; }
    clearActionHighlight();
    this.classList.add('active');
    renderVariableInputs(null);
    renderImagePrompts(null);
    renderPreview();
    setError('');
    setStatus('Action armed: ' + action.replace(/_/g, ' ') + ' \\u2014 press Generate.');
  }
  var quickButtons = panel.querySelectorAll('.ai-quick-action');
  var qi;
  for (qi = 0; qi < quickButtons.length; qi++) {
    quickButtons[qi].addEventListener('click', onQuickClick);
  }
  if (presetSelect) {
    fetch('/api/admin/ai/presets?active_only=true&per_page=200', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { if (json && json.items) { populatePresets(json.items); } })
      .catch(function () { setStatus('Presets unavailable'); });
    presetSelect.addEventListener('change', function () { applySelectedPreset(); });
  }

  // ---- Quick-action prompt builders (context-driven) ----
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

  // ---- Generate: one button, legacy gating, mode-based routing ----
  function composePrompt() {
    var instructions = promptEl && promptEl.value ? promptEl.value.trim() : '';
    var base = '';
    if (activeAction) {
      base = buildQuickPrompt(activeAction);
    } else if (activePreset) {
      base = resolveText(presetTemplate(activePreset)).resolved;
    }
    if (base && instructions) { return base + '\\n\\nAdditional instructions: ' + instructions; }
    return base || instructions;
  }
  function generate(url, kind, action, promptOverride) {
    var text = promptOverride && promptOverride.trim
      ? promptOverride.trim()
      : composePrompt();
    if (!text) {
      setError('Pick a quick action or a preset (or type instructions).');
      return;
    }
    setError('');
    setBusy(true);
    setStatus('Generating\\u2026');
    var payload = { prompt: text };
    var siteId = readSiteId();
    if (siteId) { payload.site_id = siteId; }
    payload.options = {
      tone: toneEl && toneEl.value ? toneEl.value : '',
      length: lengthEl && lengthEl.value ? lengthEl.value : ''
    };
    payload.context = getContextValues();
    if (activePreset) {
      payload.presetId = activePreset.id;
      payload.variables = variableValues();
    }
    // A3: the edited voice overrides the preset system prompt server-side.
    if (voiceEdited && systemPromptEl && systemPromptEl.value.replace(/\\s/g, '') !== '') {
      payload.system_prompt = systemPromptEl.value;
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
  if (generateBtn) {
    generateBtn.addEventListener('click', function () {
      // Legacy gate: a preset's required variables block generation.
      if (activePreset) {
        var missing = missingRequired();
        if (missing.length > 0) {
          updateRequiredWarning();
          setError('Fill the required fields first.');
          missing[0].focus();
          return;
        }
      }
      // Image-category presets generate an image (the writer-editable
      // image-prompt box wins as the prompt when present).
      if (activePreset && activePreset.category === 'image') {
        var box = imagePrompts && !imagePrompts.hidden ? imagePrompts.querySelector('.ai-image-prompt') : null;
        var override = box && box.value ? box.value : null;
        generate('/api/admin/ai/image', 'image', null, override);
        return;
      }
      generate('/api/admin/ai/chat', 'text', activeAction);
    });
  }

  // ---- Results ----
  function showResult(kind, data, action) {
    lastResult = { kind: kind, data: data };
    while (resultEl.firstChild) { resultEl.removeChild(resultEl.firstChild); }
    var autoFilled = null;
    if (kind === 'image' && data.image_url) {
      var img = document.createElement('img');
      img.src = data.image_url;
      img.alt = 'AI generated image';
      img.className = 'ai-result-image';
      resultEl.appendChild(img);
    } else {
      var resultText = data.text || '';
      if (resultText.replace(/\\s/g, '') === '') {
        resultSection.hidden = true;
        setError('The model returned no text. Try Length: Long, or a lighter preset for this action.');
        setStatus('');
        return;
      }
      var pre = document.createElement('pre');
      pre.className = 'ai-result-text';
      pre.appendChild(document.createTextNode(resultText));
      resultEl.appendChild(pre);
      var structured = extractStructured(resultText);
      if (structured) {
        autoFilled = applyStructured(structured);
      } else if (action === 'outline' || action === 'rewrite') {
        insertContent(resultText);
      }
    }
    resultSection.hidden = false;
    if (autoFilled && autoFilled.length) {
      setStatus('Auto-filled: ' + autoFilled.join(', '));
    } else {
      setStatus('Done (model: ' + (data.model || 'unknown') + ')');
    }
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      lastResult = null;
      while (resultEl.firstChild) { resultEl.removeChild(resultEl.firstChild); }
      resultSection.hidden = true;
      setStatus('');
      setError('');
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      if (!lastResult) { return; }
      var text = lastResult.kind === 'image' ? (lastResult.data.image_url || '') : (lastResult.data.text || '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { setStatus('Copied'); }).catch(function () { setStatus('Copy failed'); });
      }
    });
  }
  if (insertBtn) {
    insertBtn.addEventListener('click', function () {
      if (!lastResult) { return; }
      if (lastResult.kind === 'image') {
        var editor = window.blockEditor || null;
        if (editor && typeof editor.addBlock === 'function' && lastResult.data.image_url) {
          editor.addBlock('image', { url: lastResult.data.image_url, alt: '', caption: '' });
          setStatus('Image inserted');
        }
        return;
      }
      var structured = extractStructured(lastResult.data.text || '');
      if (structured) {
        var filled = applyStructured(structured);
        setStatus(filled.length ? ('Auto-filled: ' + filled.join(', ')) : 'Inserted');
        return;
      }
      insertContent(lastResult.data.text || '');
      setStatus('Inserted into editor');
    });
  }
}());
`;
