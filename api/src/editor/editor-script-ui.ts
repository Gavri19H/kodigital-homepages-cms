// Block editor client script — UI chunk (T27 [B6] port).
//
// This module exports a STRING of ES5 JavaScript that editor-scripts.ts
// concatenates into the editor IIFE after the BlockEditor constructor.
// It defines the per-block editing UIs for all ten block types
// (paragraph, heading, list, quote, image, divider, html, pullquote,
// callout, affiliate), the per-block controls (move up / move down /
// AI assist / remove), and the add-block menu.
//
// HARD CONTRACT: the string below must stay ES5-only — no arrow
// functions, no block-scoped declarations, no classes, no template
// literals. test/editor.test.ts (T27.AC3) asserts this on the assembled
// editorScripts() output.

export const EDITOR_UI_SCRIPT = `
  var AI_TEXT_TYPES = ['paragraph', 'heading', 'quote', 'pullquote', 'callout'];

  var BLOCK_MENU = [
    { type: 'paragraph', label: 'Paragraph', icon: '\\u00b6' },
    { type: 'heading', label: 'Heading 2', icon: 'H2', data: { level: 2 } },
    { type: 'heading', label: 'Heading 3', icon: 'H3', data: { level: 3 } },
    { type: 'list', label: 'Bullet list', icon: '\\u2022', data: { style: 'unordered' } },
    { type: 'list', label: 'Numbered list', icon: '1.', data: { style: 'ordered' } },
    { type: 'quote', label: 'Quote', icon: '\\u201d' },
    { type: 'pullquote', label: 'Pullquote', icon: '\\u275d' },
    { type: 'callout', label: 'Callout box', icon: '\\u24d8' },
    { type: 'affiliate', label: 'Affiliate card', icon: '$' },
    { type: 'image', label: 'Image', icon: '\\ud83d\\uddbc' },
    { type: 'divider', label: 'Divider', icon: '\\u2014' },
    { type: 'html', label: 'HTML', icon: '<>' },
    { type: 'separator' },
    { type: 'ai-image', label: 'AI image', icon: '\\u2728' }
  ];

  BlockEditor.prototype.makeTextarea = function (value, placeholder, rows, onInput) {
    var ta = document.createElement('textarea');
    ta.rows = rows;
    ta.placeholder = placeholder;
    ta.value = value;
    ta.addEventListener('input', function () { onInput(ta.value); });
    return ta;
  };

  BlockEditor.prototype.makeInput = function (value, placeholder, onInput) {
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value;
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  };

  BlockEditor.prototype.makeSelect = function (options, selected, onChange) {
    var select = document.createElement('select');
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement('option');
      opt.value = options[i].value;
      opt.textContent = options[i].label;
      if (options[i].value === selected) { opt.selected = true; }
      select.appendChild(opt);
    }
    select.addEventListener('change', function () { onChange(select.value); });
    return select;
  };

  BlockEditor.prototype.makeLabel = function (text) {
    var label = document.createElement('div');
    label.className = 'editor-block-label';
    label.textContent = text;
    return label;
  };

  BlockEditor.prototype.makeCtrl = function (label, title, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'editor-block-ctrl';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  };

  BlockEditor.prototype.buildBlockBody = function (index, block) {
    var self = this;
    var body = document.createElement('div');
    body.className = 'editor-block-body';
    var data = block.data || (block.data = {});
    if (block.type === 'divider') {
      body.appendChild(document.createElement('hr'));
    } else if (block.type === 'image') {
      this.buildImageBody(body, block);
    } else if (block.type === 'list') {
      body.appendChild(this.makeSelect(
        [{ value: 'unordered', label: 'Bullet list' }, { value: 'ordered', label: 'Numbered list' }],
        data.style || 'unordered',
        function (v) { data.style = v; self.sync(); }
      ));
      body.appendChild(this.makeTextarea(
        (data.items || []).join('\\n'), 'One item per line', 4,
        function (v) { data.items = v.split('\\n'); self.sync(); }
      ));
    } else if (block.type === 'heading') {
      body.appendChild(this.makeSelect(
        [{ value: '2', label: 'Heading 2' }, { value: '3', label: 'Heading 3' }],
        String(data.level || 2),
        function (v) { data.level = parseInt(v, 10); self.sync(); }
      ));
      body.appendChild(this.makeTextarea(data.text || '', 'Heading', 1,
        function (v) { data.text = v; self.sync(); }));
    } else if (block.type === 'quote' || block.type === 'pullquote') {
      body.appendChild(this.makeTextarea(
        data.text || '', block.type === 'pullquote' ? 'Pullquote' : 'Quote', 2,
        function (v) { data.text = v; self.sync(); }
      ));
      body.appendChild(this.makeInput(data.cite || '', 'Citation (optional)',
        function (v) { data.cite = v; self.sync(); }));
    } else if (block.type === 'callout') {
      body.appendChild(this.makeLabel('Callout box'));
      body.appendChild(this.makeInput(data.title || '', 'Title (optional)',
        function (v) { data.title = v; self.sync(); }));
      body.appendChild(this.makeTextarea(data.text || '', 'Callout text', 3,
        function (v) { data.text = v; self.sync(); }));
    } else if (block.type === 'affiliate') {
      body.appendChild(this.makeLabel('Affiliate card'));
      body.appendChild(this.makeInput(data.title || '', 'Product or offer title',
        function (v) { data.title = v; self.sync(); }));
      body.appendChild(this.makeInput(data.url || '', 'Outbound URL (https://...)',
        function (v) { data.url = v; self.sync(); }));
      body.appendChild(this.makeTextarea(data.description || '', 'Description (optional)', 2,
        function (v) { data.description = v; self.sync(); }));
      body.appendChild(this.makeInput(data.cta || '', 'Button text (default: Learn more)',
        function (v) { data.cta = v; self.sync(); }));
    } else if (block.type === 'html') {
      body.appendChild(this.makeLabel('Raw HTML (sanitized on render)'));
      body.appendChild(this.makeTextarea(data.html || '', '<p>...</p>', 4,
        function (v) { data.html = v; self.sync(); }));
    } else {
      body.appendChild(this.makeTextarea(data.text || '', 'Paragraph', 3,
        function (v) { data.text = v; self.sync(); }));
    }
    return body;
  };

  BlockEditor.prototype.renderBlockEl = function (index, block) {
    var self = this;
    var el = document.createElement('div');
    el.className = 'editor-block editor-block-' + block.type;
    el.setAttribute('data-index', String(index));
    el.setAttribute('data-block-type', block.type);
    el.appendChild(this.buildBlockBody(index, block));
    var controls = document.createElement('div');
    controls.className = 'editor-block-controls';
    controls.appendChild(this.makeCtrl('\\u2191', 'Move up', function () { self.moveBlock(index, -1); }));
    controls.appendChild(this.makeCtrl('\\u2193', 'Move down', function () { self.moveBlock(index, 1); }));
    if (AI_TEXT_TYPES.indexOf(block.type) !== -1) {
      controls.appendChild(this.makeCtrl('\\u2728', 'AI assist', function () { self.requestAIAssist(index); }));
    }
    var remove = this.makeCtrl('\\u00d7', 'Remove block', function () { self.removeBlock(index); });
    remove.className += ' editor-block-ctrl-remove';
    controls.appendChild(remove);
    el.appendChild(controls);
    return el;
  };

  BlockEditor.prototype.showBlockMenu = function () {
    var self = this;
    var existing = this.addBlockArea.querySelector('.editor-block-menu');
    if (existing) { existing.remove(); return; }
    var menu = document.createElement('div');
    menu.className = 'editor-block-menu';
    for (var i = 0; i < BLOCK_MENU.length; i++) {
      (function (entry) {
        if (entry.type === 'separator') {
          var sep = document.createElement('div');
          sep.className = 'editor-block-menu-sep';
          menu.appendChild(sep);
          return;
        }
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'editor-block-menu-item';
        item.setAttribute('data-menu-type', entry.type);
        var icon = document.createElement('span');
        icon.className = 'editor-block-menu-icon';
        icon.textContent = entry.icon;
        var text = document.createElement('span');
        text.textContent = entry.label;
        item.appendChild(icon);
        item.appendChild(text);
        item.addEventListener('click', function () {
          menu.remove();
          if (entry.type === 'ai-image') {
            self.showAIImageDialog();
          } else {
            self.addBlock(entry.type, entry.data || {});
          }
        });
        menu.appendChild(item);
      }(BLOCK_MENU[i]));
    }
    function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    }
    window.setTimeout(function () { document.addEventListener('click', closeMenu); }, 0);
    this.addBlockArea.appendChild(menu);
  };
`;
