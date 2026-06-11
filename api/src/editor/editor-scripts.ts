// Client-side block editor bootstrap script (T27 [B6] full port).
//
// `editorScripts()` returns an IIFE string that the admin form templates
// inject into a `<script>` tag. The IIFE finds every
// `textarea[name="content_json"]` in the rendered document and mounts a
// `BlockEditor` instance on it. The textarea is hidden and a sibling
// `.block-editor` UI takes over, syncing JSON state back to the textarea
// on every edit so the existing form submit pipeline keeps working.
//
// All ten block types are supported: paragraph, heading, list, quote,
// image, divider, html, pullquote, callout, affiliate — matching the
// server-side renderer in ./blocks.ts. Output shape matches
// `ContentDocument` ({ version, blocks: [{type, data}] }).
//
// The ported feature set (drag & drop image upload, add-block menu,
// AI image generation, AI-assist hooks) lives in ./editor-script-ui.ts
// and ./editor-script-media.ts as ES5 string chunks concatenated into
// the same IIFE. `initBlockEditor(target, options)` is the programmatic
// mount hook (window.initBlockEditor / window.refreshBlockEditor are
// the entry points the admin AI assistant panel uses).
//
// HARD CONTRACT (T27.AC3): the assembled script string is ES5-only —
// no arrow functions, no block-scoped declarations. Module-level
// TypeScript here may use ES6; the script LITERALS may not.

import { EDITOR_MEDIA_SCRIPT } from "./editor-script-media";
import { EDITOR_UI_SCRIPT } from "./editor-script-ui";
import { EDITOR_CSS } from "./editor-styles";

export const editorStyles = EDITOR_CSS;

const CORE_SCRIPT = `
  function injectStyles() {
    if (document.getElementById('block-editor-styles')) { return; }
    var styleEl = document.createElement('style');
    styleEl.id = 'block-editor-styles';
    styleEl.appendChild(document.createTextNode(EDITOR_CSS));
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function parseInitial(raw) {
    var trimmed = (raw || '').replace(/^\\s+|\\s+$/g, '');
    if (!trimmed) { return [{ type: 'paragraph', data: { text: '' } }]; }
    try {
      var doc = JSON.parse(trimmed);
      if (doc && Object.prototype.toString.call(doc.blocks) === '[object Array]') {
        if (doc.blocks.length === 0) { return [{ type: 'paragraph', data: { text: '' } }]; }
        return doc.blocks;
      }
    } catch (e) { /* fall through */ }
    return [{ type: 'paragraph', data: { text: trimmed } }];
  }

  var TOOLBAR_BUTTONS = [
    { label: '\\u00b6 Paragraph', type: 'paragraph' },
    { label: 'H2', type: 'heading', data: { level: 2 } },
    { label: '\\u2022 List', type: 'list', data: { style: 'unordered' } },
    { label: '\\u201d Quote', type: 'quote' },
    { label: '\\u275d Pullquote', type: 'pullquote' },
    { label: '\\ud83d\\uddbc Image', type: 'image' },
    { label: '\\u2728 AI image', type: 'ai-image' }
  ];

  function BlockEditor(textarea, options) {
    this.textarea = textarea;
    this.options = options || {};
    this.blocks = parseInitial(textarea.value);
    injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'block-editor';
    this.toolbar = this.createToolbar();
    this.root.appendChild(this.toolbar);
    this.blocksEl = document.createElement('div');
    this.blocksEl.className = 'editor-blocks';
    this.root.appendChild(this.blocksEl);
    this.addBlockArea = this.createAddBlockArea();
    this.root.appendChild(this.addBlockArea);
    textarea.parentNode.insertBefore(this.root, textarea);
    textarea.setAttribute('hidden', 'hidden');
    textarea.style.display = 'none';
    this.render();
  }

  BlockEditor.prototype.createToolbar = function () {
    var self = this;
    var bar = document.createElement('div');
    bar.className = 'editor-toolbar';
    for (var i = 0; i < TOOLBAR_BUTTONS.length; i++) {
      (function (def) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = def.type === 'ai-image' ? 'editor-btn editor-btn-ai' : 'editor-btn';
        btn.setAttribute('data-block-type', def.type);
        btn.textContent = def.label;
        btn.addEventListener('click', function () {
          if (def.type === 'ai-image') {
            self.showAIImageDialog();
          } else {
            self.addBlock(def.type, def.data || {});
          }
        });
        bar.appendChild(btn);
      }(TOOLBAR_BUTTONS[i]));
    }
    return bar;
  };

  BlockEditor.prototype.createAddBlockArea = function () {
    var self = this;
    var area = document.createElement('div');
    area.className = 'editor-add-block';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'editor-add-block-btn';
    btn.textContent = '+ Add block';
    btn.addEventListener('click', function () { self.showBlockMenu(); });
    area.appendChild(btn);
    return area;
  };

  BlockEditor.prototype.defaultData = function (type, data) {
    var d = data || {};
    switch (type) {
      case 'paragraph': return { text: d.text || '' };
      case 'heading': return { level: d.level || 2, text: d.text || '' };
      case 'list': return { style: d.style || 'unordered', items: d.items || [''] };
      case 'quote':
      case 'pullquote': return { text: d.text || '', cite: d.cite || '' };
      case 'image': return { src: d.src || '', alt: d.alt || '', media_id: d.media_id || null };
      case 'callout': return { title: d.title || '', text: d.text || '' };
      case 'affiliate': return { title: d.title || '', url: d.url || '', description: d.description || '', cta: d.cta || '' };
      case 'html': return { html: d.html || '' };
      case 'divider': return {};
      default: return d;
    }
  };

  BlockEditor.prototype.addBlock = function (type, data) {
    this.blocks.push({ type: type, data: this.defaultData(type, data) });
    this.render();
  };

  BlockEditor.prototype.removeBlock = function (index) {
    this.blocks.splice(index, 1);
    if (this.blocks.length === 0) {
      this.blocks = [{ type: 'paragraph', data: { text: '' } }];
    }
    this.render();
  };

  BlockEditor.prototype.moveBlock = function (index, delta) {
    var target = index + delta;
    if (target < 0 || target >= this.blocks.length) { return; }
    var moved = this.blocks[index];
    this.blocks[index] = this.blocks[target];
    this.blocks[target] = moved;
    this.render();
  };

  BlockEditor.prototype.render = function () {
    while (this.blocksEl.firstChild) {
      this.blocksEl.removeChild(this.blocksEl.firstChild);
    }
    for (var i = 0; i < this.blocks.length; i++) {
      this.blocksEl.appendChild(this.renderBlockEl(i, this.blocks[i]));
    }
    this.sync();
  };

  BlockEditor.prototype.sync = function () {
    this.textarea.value = JSON.stringify({ version: 1, blocks: this.blocks });
  };

  BlockEditor.prototype.getContent = function () {
    return { version: 1, blocks: this.blocks };
  };

  BlockEditor.prototype.setContent = function (doc) {
    var blocks = doc && Object.prototype.toString.call(doc.blocks) === '[object Array]' ? doc.blocks : [];
    this.blocks = blocks.length > 0 ? blocks : [{ type: 'paragraph', data: { text: '' } }];
    this.render();
  };

  BlockEditor.prototype.loadFromTextarea = function () {
    this.blocks = parseInitial(this.textarea.value);
    this.render();
  };
`;

const BOOT_SCRIPT = `
  function initBlockEditor(target, options) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) { return null; }
    var ta = el.tagName === 'TEXTAREA' ? el : el.querySelector('textarea[name="content_json"]');
    if (!ta) { return null; }
    if (ta.getAttribute('data-editor-mounted') === '1') { return window.blockEditor || null; }
    ta.setAttribute('data-editor-mounted', '1');
    var editor = new BlockEditor(ta, options || {});
    window.blockEditor = editor;
    return editor;
  }

  function initEditors() {
    var nodes = document.querySelectorAll('textarea[name="content_json"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-editor-mounted') === '1') { continue; }
      nodes[i].setAttribute('data-editor-mounted', '1');
      try {
        var editor = new BlockEditor(nodes[i], {});
        if (!window.blockEditor) { window.blockEditor = editor; }
      } catch (e) { /* ignore */ }
    }
  }

  if (typeof window !== 'undefined') {
    window.BlockEditor = BlockEditor;
    window.initBlockEditor = initBlockEditor;
    window.refreshBlockEditor = function () {
      if (window.blockEditor) { window.blockEditor.loadFromTextarea(); }
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditors);
  } else {
    initEditors();
  }
`;

export function editorScripts(): string {
  return (
    "(function () {\n  var EDITOR_CSS = " +
    JSON.stringify(EDITOR_CSS) +
    ";\n" +
    CORE_SCRIPT +
    EDITOR_UI_SCRIPT +
    EDITOR_MEDIA_SCRIPT +
    BOOT_SCRIPT +
    "\n}());"
  );
}
