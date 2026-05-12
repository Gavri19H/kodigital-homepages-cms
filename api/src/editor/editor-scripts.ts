// Client-side block editor bootstrap script.
//
// `editorScripts()` returns an IIFE string that the admin form templates
// inject into a `<script>` tag. The IIFE finds every
// `textarea[name="content_json"]` in the rendered document and mounts a
// `BlockEditor` instance on it. The textarea is hidden and a sibling
// `.block-editor` UI takes over, syncing JSON state back to the textarea
// on every edit so the existing form submit pipeline keeps working.
//
// Six block types are supported: paragraph, heading, list, quote, image,
// divider — matching the server-side renderer in ./blocks.ts. Output
// shape matches `ContentDocument` ({ version, blocks: [{type, data}] }).

export function editorScripts(): string {
  return SCRIPT;
}

export const editorStyles = `
.block-editor { border: 1px solid #d0d5dd; border-radius: 6px; padding: 12px; background: #fff; margin-bottom: 12px; }
.editor-toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #e4e7ec; }
.editor-btn { padding: 4px 10px; border: 1px solid #d0d5dd; background: #f9fafb; border-radius: 4px; cursor: pointer; font-size: 13px; }
.editor-btn:hover { background: #f2f4f7; }
.editor-blocks { display: flex; flex-direction: column; gap: 8px; }
.editor-block { display: flex; gap: 6px; align-items: flex-start; padding: 6px; border: 1px solid transparent; border-radius: 4px; }
.editor-block:focus-within { border-color: #d0d5dd; background: #f9fafb; }
.editor-block textarea, .editor-block input[type="text"] { flex: 1; width: 100%; font: inherit; padding: 6px 8px; border: 1px solid #d0d5dd; border-radius: 4px; }
.editor-block-heading textarea { font-weight: 600; font-size: 18px; }
.editor-block-remove { width: 28px; height: 28px; border: 1px solid #d0d5dd; background: #fff; border-radius: 4px; cursor: pointer; }
.editor-block-remove:hover { background: #fef3f2; border-color: #fda29b; color: #b42318; }
`;

const SCRIPT = `(function () {
  var BLOCK_TYPES = ['paragraph', 'heading', 'list', 'quote', 'image', 'divider'];
  var BLOCK_LABELS = {
    paragraph: 'Paragraph',
    heading: 'Heading',
    list: 'List',
    quote: 'Quote',
    image: 'Image',
    divider: 'Divider'
  };

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

  function BlockEditor(textarea) {
    this.textarea = textarea;
    this.blocks = parseInitial(textarea.value);
    this.root = document.createElement('div');
    this.root.className = 'block-editor';
    this.toolbar = this.createToolbar();
    this.root.appendChild(this.toolbar);
    this.blocksEl = document.createElement('div');
    this.blocksEl.className = 'editor-blocks';
    this.root.appendChild(this.blocksEl);
    textarea.parentNode.insertBefore(this.root, textarea);
    textarea.setAttribute('hidden', 'hidden');
    textarea.style.display = 'none';
    this.render();
  }

  BlockEditor.prototype.createToolbar = function () {
    var bar = document.createElement('div');
    bar.className = 'editor-toolbar';
    var self = this;
    for (var i = 0; i < BLOCK_TYPES.length; i++) {
      var t = BLOCK_TYPES[i];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'editor-btn editor-btn-' + t;
      btn.setAttribute('data-block-type', t);
      btn.textContent = '+ ' + BLOCK_LABELS[t];
      (function (type) {
        btn.addEventListener('click', function () { self.addBlock(type); });
      }(t));
      bar.appendChild(btn);
    }
    return bar;
  };

  BlockEditor.prototype.addBlock = function (type) {
    this.blocks.push({ type: type, data: {} });
    this.render();
  };

  BlockEditor.prototype.removeBlock = function (index) {
    this.blocks.splice(index, 1);
    if (this.blocks.length === 0) {
      this.blocks = [{ type: 'paragraph', data: { text: '' } }];
    }
    this.render();
  };

  BlockEditor.prototype.render = function () {
    var self = this;
    this.blocksEl.innerHTML = '';
    for (var i = 0; i < this.blocks.length; i++) {
      this.blocksEl.appendChild(this.renderBlock(i, this.blocks[i]));
    }
    this.sync();
  };

  BlockEditor.prototype.renderBlock = function (index, block) {
    var self = this;
    var el = document.createElement('div');
    el.className = 'editor-block editor-block-' + block.type;
    el.setAttribute('data-index', String(index));
    el.setAttribute('data-block-type', block.type);
    var body = document.createElement('div');
    body.style.flex = '1';
    if (block.type === 'divider') {
      var hr = document.createElement('hr');
      body.appendChild(hr);
    } else if (block.type === 'image') {
      var srcInput = document.createElement('input');
      srcInput.type = 'text';
      srcInput.placeholder = 'Image URL';
      srcInput.value = (block.data && block.data.src) || '';
      srcInput.addEventListener('input', function () {
        block.data = block.data || {};
        block.data.src = srcInput.value;
        self.sync();
      });
      body.appendChild(srcInput);
      var altInput = document.createElement('input');
      altInput.type = 'text';
      altInput.placeholder = 'Alt text';
      altInput.value = (block.data && block.data.alt) || '';
      altInput.style.marginTop = '6px';
      altInput.addEventListener('input', function () {
        block.data = block.data || {};
        block.data.alt = altInput.value;
        self.sync();
      });
      body.appendChild(altInput);
    } else if (block.type === 'list') {
      var listInput = document.createElement('textarea');
      listInput.rows = 4;
      listInput.placeholder = 'One item per line';
      var items = (block.data && block.data.items) || [];
      listInput.value = items.join('\\n');
      listInput.addEventListener('input', function () {
        block.data = block.data || {};
        block.data.items = listInput.value.split('\\n');
        self.sync();
      });
      body.appendChild(listInput);
    } else {
      var ta = document.createElement('textarea');
      ta.rows = block.type === 'heading' ? 1 : 3;
      ta.value = (block.data && block.data.text) || '';
      ta.placeholder = BLOCK_LABELS[block.type] || 'Text';
      ta.addEventListener('input', function () {
        block.data = block.data || {};
        block.data.text = ta.value;
        self.sync();
      });
      body.appendChild(ta);
    }
    el.appendChild(body);
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'editor-block-remove';
    remove.setAttribute('aria-label', 'Remove block');
    remove.textContent = 'x';
    remove.addEventListener('click', function () { self.removeBlock(index); });
    el.appendChild(remove);
    return el;
  };

  BlockEditor.prototype.sync = function () {
    this.textarea.value = JSON.stringify({ version: 1, blocks: this.blocks });
  };

  function initEditors() {
    var nodes = document.querySelectorAll('textarea[name="content_json"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-editor-mounted') === '1') { continue; }
      nodes[i].setAttribute('data-editor-mounted', '1');
      try { new BlockEditor(nodes[i]); } catch (e) { /* ignore */ }
    }
  }

  if (typeof window !== 'undefined') { window.BlockEditor = BlockEditor; }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEditors);
  } else {
    initEditors();
  }
}());`;
