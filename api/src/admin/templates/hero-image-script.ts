// Admin Article editor — Hero image card inline script (T14b legacy port).
// Re-exported through ./hero-image so callers keep a single import. Split out
// of hero-image.ts to keep each module focused (matches the ai-panel.ts /
// ai-panel-script.ts decomposition).
//
// HARD CONTRACT (es5-inline-scripts rule / L-014): this is an ES5-only string
// — no arrow functions, no const/let, no template literals INSIDE the
// literal. Regex backslashes are DOUBLE-escaped (`\\{` emits `\{`).
//
// Wires the hero image card:
//   - file UPLOAD -> POST /admin/media (multipart 'file') -> set the hidden
//     featured_image_id + the card preview,
//   - the AI hero-image modal: open/close, preset selector (variables +
//     live interpolated prompt-preview), Generate -> POST /api/admin/ai/image
//     {prompt, site_id?, size, style, quality, alt_text, presetId?, variables?}
//     (the selected preset is forwarded so the server applies/records it),
//     a preview of the generated image + an error region, and Apply -> place
//     the generated image into the article (set featured_image_id + preview,
//     close modal).

export const heroImageScripts = `
(function () {
  var card = document.getElementById('hero-image-card');
  if (!card) { return; }
  var TOKEN_RE = /\\{\\{\\s*([\\w.\\-]+)\\s*\\}\\}/g;
  var hiddenInput = document.getElementById('hero-image-input');
  var preview = document.getElementById('hero-image-preview');
  var previewWrap = document.getElementById('hero-image-preview-wrap');
  var emptyMsg = document.getElementById('hero-image-empty');
  var uploadInput = document.getElementById('hero-image-upload');
  var aiGenerateOpen = document.getElementById('hero-image-ai-generate');
  var removeBtn = document.getElementById('hero-image-remove');
  var cardError = document.getElementById('hero-image-error');
  var cardStatus = document.getElementById('hero-image-status');

  var modal = document.getElementById('hero-ai-modal');
  var closeBtn = document.getElementById('hero-ai-close');
  var cancelBtn = document.getElementById('hero-ai-cancel');
  var presetSelect = document.getElementById('hero-ai-preset');
  var presetVars = document.getElementById('hero-ai-variables');
  var promptPreview = document.getElementById('hero-ai-preview');
  var sizeEl = document.getElementById('hero-ai-size');
  var styleEl = document.getElementById('hero-ai-style');
  var qualityEl = document.getElementById('hero-ai-quality');
  var promptEl = document.getElementById('hero-ai-prompt');
  var modalError = document.getElementById('hero-ai-error');
  var modalStatus = document.getElementById('hero-ai-status');
  var resultBox = document.getElementById('hero-ai-result');
  var resultImg = document.getElementById('hero-ai-result-image');
  var generateBtn = document.getElementById('hero-ai-generate-btn');
  var applyBtn = document.getElementById('hero-ai-apply-btn');

  var presetsById = {};
  var activePreset = null;
  var pending = null;

  function setText(el, msg) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (msg) { el.appendChild(document.createTextNode(msg)); }
  }
  function setError(el, msg) {
    if (!el) { return; }
    el.hidden = !msg;
    setText(el, msg || '');
  }
  function readSiteId() {
    var el = document.querySelector('select[name="site_id"], input[name="site_id"]');
    return el && el.value ? el.value : null;
  }
  function showHeroImage(mediaId, url) {
    if (hiddenInput) { hiddenInput.value = mediaId == null ? '' : String(mediaId); }
    if (preview) {
      if (url) { preview.src = url; }
      else { preview.removeAttribute('src'); }
    }
    if (previewWrap) { previewWrap.hidden = !url; }
    if (emptyMsg) { emptyMsg.hidden = !!url; }
    if (removeBtn) { removeBtn.hidden = !url; }
  }

  // ---- File upload: POST /admin/media (multipart 'file') ----
  if (uploadInput) {
    uploadInput.addEventListener('change', function () {
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) { return; }
      setError(cardError, '');
      setText(cardStatus, 'Uploading\\u2026');
      var fd = new FormData();
      fd.append('file', file);
      fetch('/admin/media', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (json) { return { ok: res.ok, status: res.status, body: json }; });
        })
        .then(function (res) {
          if (!res.ok) {
            setText(cardStatus, '');
            setError(cardError, (res.body && res.body.error) || ('Upload failed (HTTP ' + res.status + ')'));
            return;
          }
          var url = res.body && res.body.storage_key ? '/media/' + res.body.storage_key : (res.body && res.body.image_url) || '';
          showHeroImage(res.body && res.body.id, url);
          setText(cardStatus, 'Hero image uploaded');
        })
        .catch(function () {
          setText(cardStatus, '');
          setError(cardError, 'Network error during upload');
        });
    });
  }
  if (removeBtn) {
    removeBtn.addEventListener('click', function () {
      showHeroImage(null, '');
      setText(cardStatus, 'Hero image removed');
    });
  }

  // ---- AI hero-image modal: open / close ----
  function openModal() {
    if (!modal) { return; }
    setError(modalError, '');
    setText(modalStatus, '');
    modal.hidden = false;
    if (presetSelect && !presetSelect.getAttribute('data-loaded')) { loadPresets(); }
    if (promptEl) { promptEl.focus(); }
  }
  function closeModal() {
    if (modal) { modal.hidden = true; }
  }
  if (aiGenerateOpen) { aiGenerateOpen.addEventListener('click', openModal); }
  if (closeBtn) { closeBtn.addEventListener('click', closeModal); }
  if (cancelBtn) { cancelBtn.addEventListener('click', closeModal); }
  if (modal) {
    modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });
  }

  // ---- Preset selector: variables + live interpolated prompt preview ----
  function loadPresets() {
    if (!presetSelect) { return; }
    presetSelect.setAttribute('data-loaded', '1');
    fetch('/api/admin/ai/presets?active_only=true&per_page=200', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { if (json && json.items) { populatePresets(json.items); } })
      .catch(function () { setText(modalStatus, 'Presets unavailable'); });
  }
  function populatePresets(rows) {
    var i, row, opt;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row || !row.is_active) { continue; }
      presetsById[String(row.id)] = row;
      opt = document.createElement('option');
      opt.value = String(row.id);
      opt.textContent = row.name || row.slug;
      presetSelect.appendChild(opt);
    }
  }
  function presetTemplate(preset) {
    var sys = preset && preset.system_prompt_template ? preset.system_prompt_template : '';
    var usr = preset && preset.user_prompt_template ? preset.user_prompt_template : '';
    var base = usr || (preset && preset.prompt_template ? preset.prompt_template : '');
    if (sys) { return sys + '\\n\\n' + base; }
    return base;
  }
  function detectTokens(tpl) {
    var names = [];
    var seen = {};
    String(tpl).replace(TOKEN_RE, function (whole, name) {
      if (!seen[name]) { seen[name] = true; names.push(name); }
      return whole;
    });
    return names;
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
  function renderPreview() {
    if (!promptPreview) { return; }
    if (!activePreset) { setText(promptPreview, ''); return; }
    var prompt = interpolate(presetTemplate(activePreset), variableValues());
    setText(promptPreview, prompt);
    if (promptEl) { promptEl.value = prompt; }
  }
  function renderVariableInputs(preset) {
    if (!presetVars) { return; }
    while (presetVars.firstChild) { presetVars.removeChild(presetVars.firstChild); }
    if (!preset) { return; }
    var names = detectTokens(presetTemplate(preset));
    var i, n, wrap, span, input;
    for (i = 0; i < names.length; i++) {
      n = names[i];
      wrap = document.createElement('label');
      wrap.className = 'hero-ai-var-chip';
      span = document.createElement('span');
      span.className = 'hero-ai-var-name';
      span.textContent = '{{' + n + '}}';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'form-input hero-ai-var-input';
      input.setAttribute('data-var-name', n);
      input.placeholder = n;
      input.addEventListener('input', renderPreview);
      wrap.appendChild(span);
      wrap.appendChild(input);
      presetVars.appendChild(wrap);
    }
  }
  if (presetSelect) {
    presetSelect.addEventListener('change', function () {
      activePreset = presetsById[presetSelect.value] || null;
      renderVariableInputs(activePreset);
      renderPreview();
    });
  }

  // ---- Generate: POST /api/admin/ai/image ----
  function setBusy(busy) {
    if (generateBtn) { generateBtn.disabled = busy; }
    setText(modalStatus, busy ? 'Generating\\u2026' : '');
  }
  if (generateBtn) {
    generateBtn.addEventListener('click', function () {
      var text = promptEl && promptEl.value ? promptEl.value.replace(/^\\s+|\\s+$/g, '') : '';
      if (!text) {
        setError(modalError, 'Prompt is required');
        if (promptEl) { promptEl.focus(); }
        return;
      }
      setError(modalError, '');
      setBusy(true);
      if (applyBtn) { applyBtn.hidden = true; }
      var payload = { prompt: text, alt_text: text };
      var siteId = readSiteId();
      if (siteId) { payload.site_id = siteId; }
      if (sizeEl && sizeEl.value) { payload.size = sizeEl.value; }
      if (styleEl && styleEl.value) { payload.style = styleEl.value; }
      if (qualityEl && qualityEl.value) { payload.quality = qualityEl.value; }
      // T10 [BCL-011]: forward the selected preset so the server resolves and
      // records the editable SYSTEM preset that governs this hero-image
      // generation (no hardcoded image path). The preset's interpolated prompt
      // is already in 'prompt'; presetId + its {{variable}} values ride along.
      if (activePreset) {
        payload.presetId = activePreset.id;
        payload.variables = variableValues();
      }
      fetch('/api/admin/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().then(function (json) { return { ok: res.ok, status: res.status, body: json }; });
      }).then(function (res) {
        setBusy(false);
        if (!res.ok || !res.body || !res.body.image_url) {
          setError(modalError, (res.body && res.body.error) || ('AI image failed (HTTP ' + res.status + ')'));
          return;
        }
        pending = { media_id: res.body.media_id, image_url: res.body.image_url };
        if (resultImg) { resultImg.src = res.body.image_url; }
        if (resultBox) { resultBox.hidden = false; }
        if (applyBtn) { applyBtn.hidden = false; }
        setText(modalStatus, 'Done (model: ' + (res.body.model || 'unknown') + ') — review and apply');
      }).catch(function () {
        setBusy(false);
        setError(modalError, 'Network error');
      });
    });
  }

  // ---- Apply: place the generated image into the article ----
  if (applyBtn) {
    applyBtn.addEventListener('click', function () {
      if (!pending) { return; }
      showHeroImage(pending.media_id, pending.image_url);
      setText(cardStatus, 'Hero image set from AI generation');
      closeModal();
    });
  }
}());
`;
