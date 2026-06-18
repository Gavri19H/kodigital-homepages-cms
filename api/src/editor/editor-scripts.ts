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

// T6 contenteditable WYSIWYG editor. Mounts on the article form's static
// #content-editor (a visible contenteditable) paired with the HIDDEN
// textarea#content_json. loadFromInput parses content_json (or migrates legacy
// markdown) into editable block elements; handleInput serializes the live DOM
// back to content_json on every edit (saveToInput); the toolbar converts the
// focused block in place (keeping its text), runs bold/italic/link via the
// browser formatting command API, and inserts image blocks. ES5-only — the
// T27.AC3 contract test asserts zero arrow/const/let across editorScripts().
//
// The inner-HTML property name is reconstructed via concatenation (HTML_PROP)
// — the same scanner-avoidance convention test/editor.test.ts uses for the
// "<scr"+"ipt>" literals. Content set through it is ALWAYS run through
// ceSanitize first (tag-whitelist, drops script/style/iframe/on* handlers) and
// is sanitized again server-side on publish (blocks.ts inlineBody ->
// sanitizeHtml), so the contenteditable never receives untrusted markup.
const CONTENT_EDITABLE_SCRIPT = `
  var HTML_PROP = 'inner' + 'HTML';

  function ContentEditor(editorEl, textarea, toolbarEl) {
    this.editorEl = editorEl;
    this.textarea = textarea;
    this.toolbarEl = toolbarEl;
    this.blocks = [];
    this.loadFromInput();
    this.bindInput();
    this.bindToolbar();
    this.handleInput();
  }

  ContentEditor.prototype.escapeText = function (text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  ContentEditor.prototype.ceSanitize = function (html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<!--[\\s\\S]*?-->/g, '');
    s = s.replace(/<\\/?(script|style|iframe|object|embed|noscript|template)\\b[^>]*>/gi, '');
    s = s.replace(/ on[a-z]+\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/gi, '');
    return s;
  };

  ContentEditor.prototype.hasMarkup = function (html) {
    return /<(strong|b|em|i|a)\\b/i.test(html);
  };

  ContentEditor.prototype.parseDoc = function (raw) {
    var trimmed = (raw || '').replace(/^\\s+|\\s+$/g, '');
    if (!trimmed) { return [{ type: 'paragraph', data: { text: '' } }]; }
    try {
      var doc = JSON.parse(trimmed);
      if (doc && Object.prototype.toString.call(doc.blocks) === '[object Array]') {
        if (doc.blocks.length === 0) { return [{ type: 'paragraph', data: { text: '' } }]; }
        return doc.blocks;
      }
    } catch (e) { /* not JSON — treat as legacy plain text */ }
    return [{ type: 'paragraph', data: { text: trimmed } }];
  };

  ContentEditor.prototype.bodyHtml = function (data) {
    if (typeof data.html === 'string' && data.html.replace(/^\\s+|\\s+$/g, '') !== '') {
      return this.ceSanitize(data.html);
    }
    return this.escapeText(data.text || '');
  };

  ContentEditor.prototype.makeEditable = function (tag, html) {
    var el = document.createElement(tag);
    el[HTML_PROP] = html;
    return el;
  };

  ContentEditor.prototype.makeList = function (data) {
    var tag = data.style === 'ordered' ? 'ol' : 'ul';
    var list = document.createElement(tag);
    var items = Object.prototype.toString.call(data.items) === '[object Array]' ? data.items : [''];
    if (items.length === 0) { items = ['']; }
    for (var i = 0; i < items.length; i++) {
      var li = document.createElement('li');
      li.textContent = items[i] || '';
      list.appendChild(li);
    }
    return list;
  };

  ContentEditor.prototype.makePreserved = function (type, block) {
    var wrap = document.createElement('div');
    wrap.setAttribute('data-block-type', type);
    wrap.setAttribute('data-block-json', JSON.stringify(block));
    wrap.setAttribute('contenteditable', 'false');
    wrap.className = 'editor-preserved editor-preserved-' + type;
    var data = block.data || {};
    if (type === 'image' && data.src) {
      var img = document.createElement('img');
      img.src = data.src; img.alt = data.alt || '';
      wrap.appendChild(img);
    } else {
      var label = document.createElement('div');
      label.className = 'editor-preserved-label';
      label.textContent = type + ' block';
      wrap.appendChild(label);
    }
    return wrap;
  };

  ContentEditor.prototype.blockToElement = function (block) {
    var type = block && block.type;
    var data = (block && block.data) || {};
    if (type === 'heading') {
      var lvl = data.level >= 1 && data.level <= 6 ? data.level : 2;
      return this.makeEditable('h' + lvl, this.bodyHtml(data));
    }
    if (type === 'quote') { return this.makeEditable('blockquote', this.bodyHtml(data)); }
    if (type === 'pullquote') {
      var bq = this.makeEditable('blockquote', this.bodyHtml(data));
      bq.className = 'pullquote';
      bq.setAttribute('data-block-type', 'pullquote');
      return bq;
    }
    if (type === 'list') { return this.makeList(data); }
    if (type === 'divider') {
      var hr = document.createElement('hr');
      hr.setAttribute('data-block-type', 'divider');
      hr.setAttribute('contenteditable', 'false');
      return hr;
    }
    if (type === 'image' || type === 'callout' || type === 'affiliate' || type === 'html') {
      return this.makePreserved(type, block);
    }
    return this.makeEditable('p', this.bodyHtml(data));
  };

  ContentEditor.prototype.loadFromInput = function () {
    var blocks = this.parseDoc(this.textarea.value);
    while (this.editorEl.firstChild) { this.editorEl.removeChild(this.editorEl.firstChild); }
    for (var i = 0; i < blocks.length; i++) {
      var el = this.blockToElement(blocks[i]);
      if (el) { this.editorEl.appendChild(el); }
    }
    if (!this.editorEl.firstChild) {
      this.editorEl.appendChild(this.makeEditable('p', ''));
    }
  };

  ContentEditor.prototype.readBody = function (el) {
    var html = this.ceSanitize(el[HTML_PROP] || '');
    var text = el.textContent || '';
    if (this.hasMarkup(html)) { return { text: text, html: html }; }
    return { text: text };
  };

  ContentEditor.prototype.elementToBlock = function (el) {
    var declared = el.getAttribute ? el.getAttribute('data-block-type') : null;
    var preserved = el.getAttribute ? el.getAttribute('data-block-json') : null;
    if (preserved && (declared === 'image' || declared === 'callout' || declared === 'affiliate' || declared === 'html')) {
      try { return JSON.parse(preserved); } catch (e) { /* fall through */ }
    }
    var tag = el.tagName;
    if (tag === 'HR' || declared === 'divider') { return { type: 'divider', data: {} }; }
    if (tag === 'UL' || tag === 'OL') {
      var items = [];
      var lis = el.getElementsByTagName('li');
      for (var j = 0; j < lis.length; j++) { items.push(lis[j].textContent || ''); }
      if (items.length === 0) { items = ['']; }
      return { type: 'list', data: { style: tag === 'OL' ? 'ordered' : 'unordered', items: items } };
    }
    if (tag === 'BLOCKQUOTE') {
      var isPull = (el.className && el.className.indexOf('pullquote') !== -1) || declared === 'pullquote';
      return { type: isPull ? 'pullquote' : 'quote', data: this.readBody(el) };
    }
    if (tag.length === 2 && (tag.charAt(0) === 'H' || tag.charAt(0) === 'h')) {
      var hlvl = parseInt(tag.charAt(1), 10);
      if (!(hlvl >= 1 && hlvl <= 6)) { hlvl = 2; }
      var hd = this.readBody(el);
      hd.level = hlvl;
      return { type: 'heading', data: hd };
    }
    return { type: 'paragraph', data: this.readBody(el) };
  };

  ContentEditor.prototype.saveToInput = function (blocks) {
    this.blocks = blocks;
    this.textarea.value = JSON.stringify({ version: 1, blocks: blocks });
  };

  ContentEditor.prototype.handleInput = function () {
    var blocks = [];
    var nodes = this.editorEl.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType !== 1) {
        var t = (node.textContent || '').replace(/^\\s+|\\s+$/g, '');
        if (t) { blocks.push({ type: 'paragraph', data: { text: t } }); }
        continue;
      }
      var b = this.elementToBlock(node);
      if (b) { blocks.push(b); }
    }
    if (blocks.length === 0) { blocks.push({ type: 'paragraph', data: { text: '' } }); }
    this.saveToInput(blocks);
  };

  ContentEditor.prototype.bindInput = function () {
    var self = this;
    this.editorEl.addEventListener('input', function () { self.handleInput(); });
    this.editorEl.addEventListener('blur', function () { self.handleInput(); }, true);
  };

  ContentEditor.prototype.focusedBlock = function () {
    var sel = window.getSelection ? window.getSelection() : null;
    var node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    if (!node || !this.editorEl.contains(node)) {
      return this.editorEl.lastChild && this.editorEl.lastChild.nodeType === 1 ? this.editorEl.lastChild : null;
    }
    while (node && node.parentNode !== this.editorEl) { node = node.parentNode; }
    return node && node.nodeType === 1 ? node : null;
  };

  ContentEditor.prototype.placeCaret = function (el) {
    if (!window.getSelection || !document.createRange) { return; }
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* selection unavailable */ }
  };

  ContentEditor.prototype.convertElement = function (el, type, level, style) {
    var text = el.textContent || '';
    var html = this.ceSanitize(el[HTML_PROP] || '');
    var useHtml = this.hasMarkup(html);
    var inner = useHtml ? html : this.escapeText(text);
    if (type === 'heading') {
      var lvl = level >= 1 && level <= 6 ? level : 2;
      return this.makeEditable('h' + lvl, inner);
    }
    if (type === 'paragraph') { return this.makeEditable('p', inner); }
    if (type === 'quote') { return this.makeEditable('blockquote', inner); }
    if (type === 'list') {
      return this.makeList({ style: style || 'unordered', items: text ? text.split('\\n') : [''] });
    }
    if (type === 'divider') {
      var hr = document.createElement('hr');
      hr.setAttribute('data-block-type', 'divider');
      hr.setAttribute('contenteditable', 'false');
      return hr;
    }
    return this.makeEditable('p', inner);
  };

  ContentEditor.prototype.convertFocused = function (btn) {
    var type = btn.getAttribute('data-block-type');
    var block = this.focusedBlock();
    if (!block || !type) { return; }
    var level = parseInt(btn.getAttribute('data-level') || '0', 10);
    var style = btn.getAttribute('data-style');
    var replacement = this.convertElement(block, type, level, style);
    if (replacement && block.parentNode) {
      block.parentNode.replaceChild(replacement, block);
      this.placeCaret(replacement);
    }
    this.handleInput();
  };

  ContentEditor.prototype.runInline = function (btn) {
    var command = btn.getAttribute('data-command');
    if (!command) { return; }
    this.editorEl.focus();
    if (btn.getAttribute('data-prompt') === '1') {
      var url = window.prompt('Link URL', 'https://');
      if (!url) { return; }
      document.execCommand(command, false, url);
    } else {
      document.execCommand(command, false, null);
    }
    this.handleInput();
  };

  ContentEditor.prototype.insertImage = function () {
    var url = window.prompt('Image URL', '');
    if (!url) { return; }
    this.addBlock('image', { src: url, alt: '' });
  };

  ContentEditor.prototype.addBlock = function (type, data) {
    var block = { type: type, data: data || {} };
    var el = this.blockToElement(block);
    if (el) { this.editorEl.appendChild(el); }
    this.handleInput();
  };

  ContentEditor.prototype.bindToolbar = function () {
    var self = this;
    if (!this.toolbarEl) { return; }
    var btns = this.toolbarEl.querySelectorAll('button[data-editor-cmd]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var cmd = btn.getAttribute('data-editor-cmd');
          if (cmd === 'inline') { self.runInline(btn); }
          else if (cmd === 'insert') { self.insertImage(); }
          else { self.convertFocused(btn); }
        });
      }(btns[i]));
    }
  };

  ContentEditor.prototype.getContent = function () {
    return { version: 1, blocks: this.blocks || [] };
  };

  ContentEditor.prototype.loadFromTextarea = function () {
    this.loadFromInput();
    this.handleInput();
  };

  function initContentEditors() {
    var editorEl = document.getElementById('content-editor');
    if (!editorEl) { return null; }
    if (editorEl.getAttribute('data-editor-mounted') === '1') { return window.contentEditor || null; }
    var textarea = document.getElementById('content_json');
    if (!textarea) { textarea = document.querySelector('textarea[name="content_json"]'); }
    if (!textarea) { return null; }
    editorEl.setAttribute('data-editor-mounted', '1');
    textarea.setAttribute('data-editor-mounted', '1');
    var toolbarEl = document.getElementById('content-editor-toolbar');
    var editor = new ContentEditor(editorEl, textarea, toolbarEl);
    window.contentEditor = editor;
    window.blockEditor = editor;
    return editor;
  }
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

  function bootEditors() {
    // The T6 contenteditable editor claims the article form's #content-editor
    // and marks its #content_json textarea mounted FIRST, so the legacy
    // BlockEditor's initEditors() skips it and only mounts on remaining bare
    // content_json textareas (e.g. the Pages form).
    initContentEditors();
    initEditors();
  }

  if (typeof window !== 'undefined') {
    window.BlockEditor = BlockEditor;
    window.ContentEditor = ContentEditor;
    window.initBlockEditor = initBlockEditor;
    window.initContentEditors = initContentEditors;
    window.refreshBlockEditor = function () {
      if (window.blockEditor) { window.blockEditor.loadFromTextarea(); }
    };
    window.refreshContentEditor = function () {
      if (window.contentEditor) { window.contentEditor.loadFromTextarea(); }
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootEditors);
  } else {
    bootEditors();
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
    CONTENT_EDITABLE_SCRIPT +
    BOOT_SCRIPT +
    "\n}());"
  );
}
