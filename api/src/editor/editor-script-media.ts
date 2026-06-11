// Block editor client script — media + AI chunk (T27 [B6] port).
//
// ES5-only string (see editor-script-ui.ts header for the contract).
// Covers: image block UI with file-picker upload AND drag-and-drop onto
// the drop zone (POST /admin/media, multipart 'file' field, same-origin
// credentials so the Access cookie rides along), the AI image dialog
// (POST /api/admin/ai/image with {prompt, site_id}), and the AI-assist
// hooks the admin AI panel consumes (getBlockContent /
// applyAIResultToBlock / the 'block-editor:ai-assist' DOM event).
//
// No markup string is ever assigned from user input here: all dynamic
// content goes through textContent / DOM element creation.

export const EDITOR_MEDIA_SCRIPT = `
  function readSiteId() {
    var el = document.querySelector('select[name="site_id"], input[name="site_id"]');
    return el && el.value ? el.value : null;
  }

  function clearChildren(el) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
  }

  BlockEditor.prototype.notify = function (message, isError) {
    if (window.showToast) {
      window.showToast(message, isError ? 'error' : 'success');
    }
  };

  BlockEditor.prototype.buildImageBody = function (body, block) {
    var self = this;
    var data = block.data || (block.data = {});
    var status = document.createElement('div');
    status.className = 'editor-block-label';
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        self.uploadImageFile(fileInput.files[0], block, status);
      }
    });
    if (data.src) {
      var preview = document.createElement('div');
      preview.className = 'editor-image-preview';
      var img = document.createElement('img');
      img.src = data.src;
      img.alt = data.alt || '';
      preview.appendChild(img);
      body.appendChild(preview);
      var actions = document.createElement('div');
      actions.className = 'editor-image-actions';
      var replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'editor-btn';
      replaceBtn.textContent = 'Replace image';
      replaceBtn.addEventListener('click', function () { fileInput.click(); });
      actions.appendChild(replaceBtn);
      body.appendChild(actions);
      this.bindImageDrop(preview, block, status);
    } else {
      var drop = document.createElement('div');
      drop.className = 'editor-image-drop';
      drop.textContent = 'Click or drag & drop an image';
      drop.addEventListener('click', function () { fileInput.click(); });
      body.appendChild(drop);
      this.bindImageDrop(drop, block, status);
      body.appendChild(this.makeInput(data.src || '', 'or paste an image URL',
        function (v) { data.src = v; self.sync(); }));
    }
    body.appendChild(this.makeInput(data.alt || '', 'Alt text',
      function (v) { data.alt = v; self.sync(); }));
    body.appendChild(fileInput);
    body.appendChild(status);
  };

  BlockEditor.prototype.bindImageDrop = function (zone, block, status) {
    var self = this;
    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        self.uploadImageFile(dt.files[0], block, status);
      }
    });
  };

  BlockEditor.prototype.uploadImageFile = function (file, block, status) {
    var self = this;
    if (!file) { return; }
    var fd = new FormData();
    fd.append('file', file);
    if (block.data && block.data.alt) { fd.append('alt', block.data.alt); }
    if (status) { status.textContent = 'Uploading\\u2026'; }
    fetch('/admin/media', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) { throw new Error('Upload failed (HTTP ' + res.status + ')'); }
        return res.json();
      })
      .then(function (row) {
        block.data = block.data || {};
        block.data.media_id = row.id;
        block.data.src = '/media/' + row.storage_key;
        self.render();
        self.notify('Image uploaded', false);
      })
      .catch(function (err) {
        if (status) { status.textContent = (err && err.message) || 'Image upload failed'; }
        self.notify((err && err.message) || 'Image upload failed', true);
      });
  };

  BlockEditor.prototype.showAIImageDialog = function () {
    var self = this;
    var overlay = document.createElement('div');
    overlay.className = 'editor-ai-overlay';
    var modal = document.createElement('div');
    modal.className = 'editor-ai-modal';
    var title = document.createElement('h3');
    title.textContent = 'Generate AI image';
    var prompt = document.createElement('textarea');
    prompt.rows = 3;
    prompt.placeholder = 'Describe the image\\u2026';
    var status = document.createElement('div');
    status.className = 'editor-ai-status';
    var result = document.createElement('div');
    result.className = 'editor-ai-result';
    var actions = document.createElement('div');
    actions.className = 'editor-ai-actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    var generateBtn = document.createElement('button');
    generateBtn.type = 'button';
    generateBtn.className = 'editor-ai-generate';
    generateBtn.textContent = 'Generate';
    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.textContent = 'Insert to editor';
    insertBtn.style.display = 'none';
    function close() { overlay.remove(); }
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); }
    });
    generateBtn.addEventListener('click', function () {
      var text = prompt.value.replace(/^\\s+|\\s+$/g, '');
      if (!text) {
        status.className = 'editor-ai-status error';
        status.textContent = 'Enter a prompt first';
        return;
      }
      generateBtn.disabled = true;
      status.className = 'editor-ai-status';
      status.textContent = 'Generating\\u2026';
      self.generateAIImage(text, function (err, gen) {
        generateBtn.disabled = false;
        if (err) {
          status.className = 'editor-ai-status error';
          status.textContent = err;
          return;
        }
        status.textContent = 'Done \\u2014 review and insert';
        clearChildren(result);
        var img = document.createElement('img');
        img.src = gen.image_url;
        img.alt = text;
        result.appendChild(img);
        insertBtn.style.display = '';
        insertBtn.onclick = function () {
          self.addBlock('image', { src: gen.image_url, media_id: gen.media_id, alt: text });
          self.notify('AI image inserted', false);
          close();
        };
      });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(insertBtn);
    actions.appendChild(generateBtn);
    modal.appendChild(title);
    modal.appendChild(prompt);
    modal.appendChild(status);
    modal.appendChild(result);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    prompt.focus();
  };

  BlockEditor.prototype.generateAIImage = function (promptText, done) {
    var payload = { prompt: promptText };
    var siteId = readSiteId();
    if (siteId) { payload.site_id = siteId; }
    fetch('/api/admin/ai/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (json) {
          if (!res.ok) {
            throw new Error((json && json.error) || ('AI image failed (HTTP ' + res.status + ')'));
          }
          return json;
        });
      })
      .then(function (json) {
        if (!json || !json.image_url) {
          throw new Error('AI image response missing image_url');
        }
        done(null, json);
      })
      .catch(function (err) {
        done((err && err.message) || 'AI image request failed', null);
      });
  };

  BlockEditor.prototype.getBlockContent = function (index) {
    var block = this.blocks[index];
    if (!block || !block.data) { return ''; }
    if (block.type === 'html') { return block.data.html || ''; }
    if (block.type === 'list') { return (block.data.items || []).join('\\n'); }
    return block.data.text || '';
  };

  BlockEditor.prototype.applyAIResultToBlock = function (index, content) {
    var block = this.blocks[index];
    if (!block) { return; }
    block.data = block.data || {};
    if (block.type === 'html') {
      block.data.html = content;
    } else if (block.type === 'list') {
      block.data.items = String(content).split('\\n');
    } else {
      block.data.text = content;
    }
    this.render();
  };

  BlockEditor.prototype.requestAIAssist = function (index) {
    var block = this.blocks[index];
    if (!block) { return; }
    var evt;
    try {
      evt = new CustomEvent('block-editor:ai-assist', {
        detail: { index: index, type: block.type, text: this.getBlockContent(index) }
      });
    } catch (e) {
      return;
    }
    document.dispatchEvent(evt);
  };
`;
