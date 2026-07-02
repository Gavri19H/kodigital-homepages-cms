/**
 * Rich Text Editor JavaScript
 *
 * A block-based editor component for the CMS admin UI.
 * Supports: paragraphs, headings (H1-H3), lists, links, quotes, dividers.
 *
 * This module exports JavaScript code as a string to be embedded in HTML templates.
 */

/**
 * Editor JavaScript code for embedding in HTML
 */
export const editorScripts = `
// =============================================================================
// Block Editor Class
// =============================================================================

class BlockEditor {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error('Editor container not found: ' + containerId);
    }

    this.options = {
      hiddenInputId: options.hiddenInputId || 'content_json',
      onChange: options.onChange || null,
      placeholder: options.placeholder || 'Start writing...',
    };

    this.blocks = [];
    this.focusedBlockId = null;
    this.init();
  }

  // Initialize the editor
  init() {
    this.container.innerHTML = '';
    this.container.className = 'block-editor';

    // Create toolbar
    this.toolbar = this.createToolbar();
    this.container.appendChild(this.toolbar);

    // Create blocks container
    this.blocksContainer = document.createElement('div');
    this.blocksContainer.className = 'editor-blocks';
    this.container.appendChild(this.blocksContainer);

    // Create add block button
    this.addBlockBtn = this.createAddBlockButton();
    this.container.appendChild(this.addBlockBtn);

    // Load initial content from hidden input
    this.loadFromInput();

    // If no blocks, add an empty paragraph
    if (this.blocks.length === 0) {
      this.addBlock('paragraph');
    }

    // Set up auto-save
    this.setupAutoSave();

    // Set up sticky toolbar behavior
    this.setupStickyToolbar();
  }

  // Set up sticky toolbar with IntersectionObserver
  setupStickyToolbar() {
    // Create a sentinel element at the top of the container
    const sentinel = document.createElement('div');
    sentinel.className = 'toolbar-sentinel';
    sentinel.style.height = '1px';
    sentinel.style.marginBottom = '-1px';
    this.container.insertBefore(sentinel, this.toolbar);

    // Create placeholder for when toolbar is fixed
    this.toolbarPlaceholder = document.createElement('div');
    this.toolbarPlaceholder.className = 'toolbar-placeholder';
    this.toolbarPlaceholder.style.display = 'none';
    this.container.insertBefore(this.toolbarPlaceholder, this.blocksContainer);

    const fixToolbar = () => {
      if (!this.toolbar.classList.contains('toolbar-fixed')) {
        const toolbarHeight = this.toolbar.offsetHeight;
        this.toolbarPlaceholder.style.height = toolbarHeight + 'px';
        this.toolbarPlaceholder.style.display = 'block';
        this.toolbar.classList.add('toolbar-fixed');
        this.toolbar.style.width = this.container.offsetWidth + 'px';
      }
    };

    const unfixToolbar = () => {
      if (this.toolbar.classList.contains('toolbar-fixed')) {
        this.toolbar.classList.remove('toolbar-fixed');
        this.toolbar.style.width = '';
        this.toolbarPlaceholder.style.display = 'none';
      }
    };

    // Use IntersectionObserver to detect when sentinel leaves viewport
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Sentinel is visible - toolbar should be in normal flow
          unfixToolbar();
        } else {
          // Sentinel is not visible - check if we scrolled past it
          const rect = entry.boundingClientRect;
          if (rect.top < 0) {
            // Scrolled past the sentinel - fix the toolbar
            fixToolbar();
          }
        }
      });
    }, { threshold: 0 });

    observer.observe(sentinel);

    // Handle resize to update toolbar width
    window.addEventListener('resize', () => {
      if (this.toolbar.classList.contains('toolbar-fixed')) {
        this.toolbar.style.width = this.container.offsetWidth + 'px';
      }
    }, { passive: true });
  }

  // Create the formatting toolbar
  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';

    const buttons = [
      { type: 'heading', level: 1, label: 'H1', title: 'Heading 1' },
      { type: 'heading', level: 2, label: 'H2', title: 'Heading 2' },
      { type: 'heading', level: 3, label: 'H3', title: 'Heading 3' },
      { type: 'divider' },
      { type: 'paragraph', label: 'P', title: 'Paragraph' },
      { type: 'list', style: 'unordered', label: '• List', title: 'Bullet List' },
      { type: 'list', style: 'ordered', label: '1. List', title: 'Numbered List' },
      { type: 'quote', label: '" Quote', title: 'Blockquote' },
      { type: 'image', label: '🖼', title: 'Insert Image' },
      { type: 'divider', style: 'ai' },
      { type: 'ai-image', label: '✨ AI', title: 'Generate AI Image' },
      { type: 'divider', style: 'ai' },
      { type: 'format', format: 'bold', label: 'B', title: 'Bold (**text**)' },
      { type: 'format', format: 'italic', label: 'I', title: 'Italic (*text*)' },
      { type: 'format', format: 'link', label: '🔗', title: 'Link ([text](url))' },
    ];

    buttons.forEach(btn => {
      if (btn.type === 'divider') {
        const divider = document.createElement('span');
        divider.className = btn.style === 'ai' ? 'toolbar-divider toolbar-divider-ai' : 'toolbar-divider';
        toolbar.appendChild(divider);
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = btn.type.startsWith('ai-') ? 'toolbar-btn toolbar-btn-ai' : 'toolbar-btn';
      button.textContent = btn.label;
      button.title = btn.title;

      if (btn.type === 'format') {
        button.addEventListener('click', () => this.applyFormat(btn.format));
      } else if (btn.type === 'heading') {
        button.addEventListener('click', () => this.convertBlock('heading', { level: btn.level }));
      } else if (btn.type === 'list') {
        button.addEventListener('click', () => this.convertBlock('list', { style: btn.style }));
      } else if (btn.type === 'image') {
        button.addEventListener('click', () => this.showImageUploadDialog());
      } else if (btn.type === 'ai-image') {
        // Prevent losing focus/selection when clicking the button
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => this.showAIImageDialog());
      } else {
        button.addEventListener('click', () => this.convertBlock(btn.type));
      }

      toolbar.appendChild(button);
    });

    return toolbar;
  }

  // Create the "add block" button
  createAddBlockButton() {
    const container = document.createElement('div');
    container.className = 'add-block-container';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-block-btn';
    btn.innerHTML = '+ Add Block';
    btn.addEventListener('click', () => this.showBlockMenu());

    container.appendChild(btn);
    return container;
  }

  // Show block type selection menu
  showBlockMenu() {
    const menu = document.createElement('div');
    menu.className = 'block-menu';

    const blockTypes = [
      { type: 'paragraph', label: 'Paragraph', icon: '¶' },
      { type: 'heading', label: 'Heading 2', icon: 'H2', data: { level: 2 } },
      { type: 'heading', label: 'Heading 3', icon: 'H3', data: { level: 3 } },
      { type: 'list-unordered', label: 'Bullet List', icon: '•' },
      { type: 'list-ordered', label: 'Numbered List', icon: '1.' },
      { type: 'quote', label: 'Quote', icon: '"' },
      { type: 'pullquote', label: 'Key idea', icon: '❝' },
      { type: 'faqgroup', label: 'FAQ', icon: '?' },
      { type: 'image', label: 'Image', icon: '🖼' },
      { type: 'divider', label: 'Divider', icon: '—' },
      { type: 'menu-separator' },
      { type: 'ai-image', label: 'AI Image', icon: '✨' },
    ];

    blockTypes.forEach(bt => {
      // Handle menu separator
      if (bt.type === 'menu-separator') {
        const separator = document.createElement('div');
        separator.className = 'block-menu-separator';
        menu.appendChild(separator);
        return;
      }

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'block-menu-item';
      item.innerHTML = '<span class="block-menu-icon">' + bt.icon + '</span><span>' + bt.label + '</span>';
      item.addEventListener('click', () => {
        menu.remove();
        if (bt.type === 'list-unordered') {
          this.addBlock('list', { style: 'unordered', items: [''] });
        } else if (bt.type === 'list-ordered') {
          this.addBlock('list', { style: 'ordered', items: [''] });
        } else if (bt.type === 'heading') {
          this.addBlock('heading', { level: bt.data.level, text: '' });
        } else if (bt.type === 'divider') {
          this.addBlock('divider');
        } else if (bt.type === 'image') {
          this.showImageUploadDialog();
        } else if (bt.type === 'ai-image') {
          this.showAIImageDialog();
        } else {
          this.addBlock(bt.type);
        }
      });
      menu.appendChild(item);
    });

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);

    this.addBlockBtn.appendChild(menu);
  }

  // Generate unique block ID
  generateId() {
    return 'block-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // Add a new block
  addBlock(type, data = {}, afterBlockId = null) {
    const id = this.generateId();
    const block = { id, type, data: this.getDefaultData(type, data) };

    if (afterBlockId) {
      const index = this.blocks.findIndex(b => b.id === afterBlockId);
      if (index !== -1) {
        this.blocks.splice(index + 1, 0, block);
      } else {
        this.blocks.push(block);
      }
    } else {
      this.blocks.push(block);
    }

    this.renderBlocks();
    this.focusBlock(id);
    this.saveToInput();
    return id;
  }

  // Get default data for a block type
  getDefaultData(type, data = {}) {
    switch (type) {
      case 'paragraph':
        return { text: data.text || '' };
      case 'heading':
        return { text: data.text || '', level: data.level || 2 };
      case 'list':
        return { style: data.style || 'unordered', items: data.items || [''] };
      case 'quote':
        return { text: data.text || '', caption: data.caption || '' };
      case 'image':
        return {
          media_id: data.media_id || null,
          url: data.url || '',
          alt: data.alt || '',
          caption: data.caption || '',
          width: data.width || 0,
          height: data.height || 0,
          alignment: data.alignment || 'center',
        };
      case 'divider':
        return {};
      case 'pullquote':
        return { text: data.text || '' };
      case 'faqgroup': {
        var items = Array.isArray(data.items) && data.items.length ? data.items : [{ q: '', a: '' }];
        return { items: items };
      }
      default:
        return data;
    }
  }

  // Delete a block
  deleteBlock(id) {
    const index = this.blocks.findIndex(b => b.id === id);
    if (index === -1) return;

    this.blocks.splice(index, 1);

    // If no blocks left, add empty paragraph
    if (this.blocks.length === 0) {
      this.addBlock('paragraph');
    } else {
      // Focus previous block or first block
      const focusIndex = Math.max(0, index - 1);
      this.renderBlocks();
      this.focusBlock(this.blocks[focusIndex].id);
    }

    this.saveToInput();
  }

  // Move block up or down
  moveBlock(id, direction) {
    const index = this.blocks.findIndex(b => b.id === id);
    if (index === -1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= this.blocks.length) return;

    // Swap blocks
    [this.blocks[index], this.blocks[newIndex]] = [this.blocks[newIndex], this.blocks[index]];

    this.renderBlocks();
    this.focusBlock(id);
    this.saveToInput();
  }

  // Convert current block to different type
  convertBlock(newType, newData = {}) {
    if (!this.focusedBlockId) return;

    const block = this.blocks.find(b => b.id === this.focusedBlockId);
    if (!block) return;

    // Get current content - read from DOM to capture HTML structure
    let currentText = '';
    let currentHtml = '';
    const blockEl = document.querySelector('[data-block-id="' + this.focusedBlockId + '"]');

    if (block.type === 'paragraph' || block.type === 'heading') {
      const editable = blockEl ? blockEl.querySelector('.editable-text') : null;
      currentHtml = editable ? editable.innerHTML || '' : (block.data.text || '');
      currentText = editable ? editable.textContent || '' : (block.data.text || '');
    } else if (block.type === 'quote') {
      const quoteText = blockEl ? blockEl.querySelector('.quote-text') : null;
      currentHtml = quoteText ? quoteText.innerHTML || '' : (block.data.text || '');
      currentText = quoteText ? quoteText.textContent || '' : (block.data.text || '');
    } else if (block.type === 'list') {
      currentText = block.data.items.join('\\n');
      currentHtml = currentText;
    }

    // Convert
    block.type = newType;
    if (newType === 'list') {
      // Split text into list items - handle <br>, <div>, <p> tags as line breaks
      let items = [''];
      if (currentHtml) {
        // Use unique delimiter to mark line breaks (avoids newline handling issues)
        const SPLIT_MARKER = '|||SPLIT|||';
        let text = currentHtml;

        // Replace line break elements with delimiter
        text = text.replace(/<br\\s*\\/?>/gi, SPLIT_MARKER);
        text = text.replace(/<\\/div>/gi, SPLIT_MARKER);
        text = text.replace(/<\\/p>/gi, SPLIT_MARKER);
        text = text.replace(/<div[^>]*>/gi, '');
        text = text.replace(/<p[^>]*>/gi, '');

        // Strip all remaining HTML tags
        text = text.replace(/<[^>]+>/g, '');

        // Decode HTML entities using textarea trick
        const decoder = document.createElement('textarea');
        decoder.innerHTML = text;
        text = decoder.value;

        // Split by delimiter and filter empty items
        items = text.split(SPLIT_MARKER).map(t => t.trim()).filter(t => t);
        if (items.length === 0) items = [''];
      }
      block.data = {
        style: newData.style || 'unordered',
        items: items
      };
    } else if (newType === 'heading') {
      block.data = { text: currentText, level: newData.level || 2 };
    } else if (newType === 'quote') {
      block.data = { text: currentText, caption: '' };
    } else if (newType === 'paragraph') {
      block.data = { text: currentText };
    }

    this.renderBlocks();
    this.focusBlock(block.id);
    this.saveToInput();
  }

  // Apply inline formatting (bold, italic, link) using HTML elements
  applyFormat(format) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const text = range.toString();
    if (!text) return;

    // Use execCommand for WYSIWYG formatting with HTML tags
    switch (format) {
      case 'bold':
        // Creates <strong> or <b> tags
        document.execCommand('bold', false, null);
        break;
      case 'italic':
        // Creates <em> or <i> tags
        document.execCommand('italic', false, null);
        break;
      case 'link':
        const url = prompt('Enter URL:', 'https://');
        if (url) {
          // Creates <a> tags with href
          document.execCommand('createLink', false, url);
        } else {
          return;
        }
        break;
    }

    // Update block data with innerHTML (includes HTML formatting)
    if (this.focusedBlockId) {
      const block = this.blocks.find(b => b.id === this.focusedBlockId);
      const element = document.querySelector('[data-block-id="' + this.focusedBlockId + '"] .block-content');
      if (block && element) {
        if (block.type === 'list') {
          // Handle list items - preserve HTML
          const items = element.querySelectorAll('.list-item-input');
          block.data.items = Array.from(items).map(i => i.innerHTML || '');
        } else {
          // Get the editable element's innerHTML to preserve formatting
          const editable = element.querySelector('.editable-text');
          if (editable) {
            block.data.text = editable.innerHTML || '';
          }
        }
        this.saveToInput();
      }
    }
  }

  // Render all blocks
  renderBlocks() {
    this.blocksContainer.innerHTML = '';

    this.blocks.forEach((block, index) => {
      const element = this.renderBlock(block, index);
      this.blocksContainer.appendChild(element);
    });
  }

  // Render a single block
  renderBlock(block, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-block' + (block.id === this.focusedBlockId ? ' focused' : '');
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;

    // Block controls
    const controls = document.createElement('div');
    controls.className = 'block-controls';
    controls.innerHTML = \`
      <button type="button" class="block-control-btn" title="Move up" onclick="window.blockEditor.moveBlock('\${block.id}', 'up')">↑</button>
      <button type="button" class="block-control-btn" title="Move down" onclick="window.blockEditor.moveBlock('\${block.id}', 'down')">↓</button>
      <button type="button" class="block-control-btn delete" title="Delete" onclick="window.blockEditor.deleteBlock('\${block.id}')">×</button>
    \`;

    // Block content
    const content = document.createElement('div');
    content.className = 'block-content';

    switch (block.type) {
      case 'paragraph':
        content.innerHTML = this.renderParagraphContent(block);
        break;
      case 'heading':
        content.innerHTML = this.renderHeadingContent(block);
        break;
      case 'list':
        content.innerHTML = this.renderListContent(block);
        break;
      case 'quote':
        content.innerHTML = this.renderQuoteContent(block);
        break;
      case 'image':
        content.innerHTML = this.renderImageContent(block);
        break;
      case 'divider':
        content.innerHTML = '<hr class="divider-preview">';
        break;
      case 'pullquote':
        content.innerHTML = this.renderPullquoteContent(block);
        break;
      case 'faqgroup':
        content.innerHTML = this.renderFaqGroupContent(block);
        break;
      default:
        content.textContent = JSON.stringify(block.data);
    }

    // Setup event listeners
    this.setupBlockEvents(wrapper, block, content);

    wrapper.appendChild(controls);
    wrapper.appendChild(content);
    return wrapper;
  }

  renderParagraphContent(block) {
    const text = this.sanitizeHtml(this.migrateMarkdownToHtml(block.data.text || ''));
    return '<div class="editable-text" contenteditable="true" data-placeholder="' + this.options.placeholder + '">' + text + '</div>';
  }

  renderHeadingContent(block) {
    const tag = 'h' + block.data.level;
    const text = this.sanitizeHtml(this.migrateMarkdownToHtml(block.data.text || ''));
    return '<' + tag + ' class="editable-text heading-' + block.data.level + '" contenteditable="true" data-placeholder="Heading...">' + text + '</' + tag + '>';
  }

  renderListContent(block) {
    const tag = block.data.style === 'ordered' ? 'ol' : 'ul';
    const items = (block.data.items || ['']).map((item, i) => {
      const text = this.sanitizeHtml(this.migrateMarkdownToHtml(item));
      return '<li><span class="list-item-input" contenteditable="true" data-item-index="' + i + '">' + text + '</span></li>';
    }).join('');
    return '<' + tag + ' class="editable-list">' + items + '</' + tag + '>';
  }

  renderQuoteContent(block) {
    const text = this.sanitizeHtml(this.migrateMarkdownToHtml(block.data.text || ''));
    const caption = this.sanitizeHtml(this.migrateMarkdownToHtml(block.data.caption || ''));
    return \`
      <blockquote class="quote-wrapper">
        <div class="editable-text quote-text" contenteditable="true" data-placeholder="Quote text...">\${text}</div>
        <cite><span class="editable-text quote-caption" contenteditable="true" data-placeholder="Attribution (optional)">\${caption}</span></cite>
      </blockquote>
    \`;
  }

  // PR-3 (issue 3): the "Key idea" pull-quote editor — a single editable box
  // (mirrors renderQuoteContent but without the attribution line). On publish
  // blocks.ts renders it as <blockquote class="pullquote"> with the .pq-mark.
  renderPullquoteContent(block) {
    var text = this.sanitizeHtml(this.migrateMarkdownToHtml(block.data.text || ''));
    return '<blockquote class="pullquote-wrapper">' +
      '<div class="editable-text pullquote-text" contenteditable="true" data-placeholder="Key idea\u2026">' + text + '</div>' +
      '</blockquote>';
  }

  // PR-3 (issue 12): the friendly FAQ editor — N repeatable Question/Answer
  // rows. Stored as ONE { type:'faqgroup', items:[{q,a}] } block; the public
  // view-model (adaptBodyBlocks) expands it into the standard faqs[] the
  // .faq-section renders, so the public output is identical to today's FAQ.
  faqEscapeAttr(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  faqEscapeText(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  renderFaqGroupContent(block) {
    var items = Array.isArray(block.data.items) && block.data.items.length ? block.data.items : [{ q: '', a: '' }];
    var self = this;
    var bid = block.id;
    var rows = items.map(function (it, i) {
      var q = self.faqEscapeAttr(it && it.q);
      var a = self.faqEscapeText(it && it.a);
      return '<div class="faq-edit-row" data-faq-row="' + i + '">' +
        '<input type="text" class="faq-edit-q" data-faq-q="' + i + '" placeholder="Question" value="' + q + '" />' +
        '<textarea class="faq-edit-a" data-faq-a="' + i + '" rows="2" placeholder="Answer">' + a + '</textarea>' +
        '<button type="button" class="faq-edit-remove" title="Remove question" onclick="window.blockEditor.removeFaqRow(\\'' + bid + '\\', ' + i + ')">\u00d7</button>' +
      '</div>';
    }).join('');
    return '<div class="faq-edit">' +
      '<div class="faq-edit-rows">' + rows + '</div>' +
      '<button type="button" class="faq-edit-add" onclick="window.blockEditor.addFaqRow(\\'' + bid + '\\')">+ Add question</button>' +
      '</div>';
  }

  // Read every FAQ row's current Q/A from the DOM into block.data.items.
  readFaqRows(block, content) {
    var rowEls = content.querySelectorAll('.faq-edit-row');
    var items = [];
    Array.prototype.forEach.call(rowEls, function (row) {
      var qEl = row.querySelector('.faq-edit-q');
      var aEl = row.querySelector('.faq-edit-a');
      items.push({ q: qEl ? (qEl.value || '') : '', a: aEl ? (aEl.value || '') : '' });
    });
    block.data.items = items.length > 0 ? items : [{ q: '', a: '' }];
  }

  addFaqRow(blockId) {
    var block = this.blocks.find(function (b) { return b.id === blockId; });
    if (!block) { return; }
    var content = document.querySelector('[data-block-id="' + blockId + '"] .block-content');
    if (content) { this.readFaqRows(block, content); }
    if (!Array.isArray(block.data.items)) { block.data.items = []; }
    block.data.items.push({ q: '', a: '' });
    this.renderBlocks();
    this.focusBlock(blockId);
    this.saveToInput();
  }

  removeFaqRow(blockId, index) {
    var block = this.blocks.find(function (b) { return b.id === blockId; });
    if (!block || !Array.isArray(block.data.items)) { return; }
    var content = document.querySelector('[data-block-id="' + blockId + '"] .block-content');
    if (content) { this.readFaqRows(block, content); }
    block.data.items.splice(index, 1);
    if (block.data.items.length === 0) { block.data.items.push({ q: '', a: '' }); }
    this.renderBlocks();
    this.focusBlock(blockId);
    this.saveToInput();
  }

  renderImageContent(block) {
    if (!block.data.url) {
      // Show upload placeholder with both upload and AI generate options
      return \`
        <div class="image-block-empty" data-block-id="\${block.id}">
          <div class="image-options-row">
            <div class="image-upload-placeholder" onclick="window.blockEditor.triggerImageUpload('\${block.id}')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <p>Upload Image</p>
              <small>Click or drag & drop</small>
            </div>
            <div class="image-or-divider">or</div>
            <div class="image-ai-generate-placeholder" onclick="window.blockEditor.showAIImageDialog('\${block.id}')">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              <p>Generate with AI</p>
              <small>Describe what you want</small>
            </div>
          </div>
          <input type="file" class="image-block-input" accept="image/*" style="display: none;" data-block-id="\${block.id}" onchange="window.blockEditor.handleImageUpload(this, '\${block.id}')" />
        </div>
      \`;
    }

    // Show image with controls
    const alignClass = 'align-' + (block.data.alignment || 'center');
    return \`
      <div class="image-block-content \${alignClass}">
        <div class="image-block-preview">
          <img src="\${this.escapeHtml(block.data.url)}" alt="\${this.escapeHtml(block.data.alt || '')}" \${block.data.width ? 'width="' + block.data.width + '"' : ''} \${block.data.height ? 'height="' + block.data.height + '"' : ''} />
          <div class="image-block-overlay">
            <button type="button" class="image-btn" onclick="window.blockEditor.showImageSettings('\${block.id}')" title="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <button type="button" class="image-btn" onclick="window.blockEditor.triggerImageUpload('\${block.id}')" title="Replace">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
              </svg>
            </button>
          </div>
          <input type="file" class="image-block-input" accept="image/*" style="display: none;" data-block-id="\${block.id}" onchange="window.blockEditor.handleImageUpload(this, '\${block.id}')" />
        </div>
        <div class="image-block-caption">
          <input type="text" class="image-caption-input" value="\${this.escapeHtml(block.data.caption || '')}" placeholder="Add caption (optional)" onchange="window.blockEditor.updateImageCaption('\${block.id}', this.value)" />
        </div>
        <div class="image-block-alignment">
          <button type="button" class="align-btn \${block.data.alignment === 'left' ? 'active' : ''}" onclick="window.blockEditor.updateImageAlignment('\${block.id}', 'left')" title="Align left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>
          </button>
          <button type="button" class="align-btn \${block.data.alignment === 'center' ? 'active' : ''}" onclick="window.blockEditor.updateImageAlignment('\${block.id}', 'center')" title="Align center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="10" x2="6" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="18" y1="18" x2="6" y2="18"></line></svg>
          </button>
          <button type="button" class="align-btn \${block.data.alignment === 'right' ? 'active' : ''}" onclick="window.blockEditor.updateImageAlignment('\${block.id}', 'right')" title="Align right">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="7" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>
          </button>
          <button type="button" class="align-btn \${block.data.alignment === 'full' ? 'active' : ''}" onclick="window.blockEditor.updateImageAlignment('\${block.id}', 'full')" title="Full width">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
          </button>
        </div>
      </div>
    \`;
  }

  // Show image upload dialog - inserts at cursor position (after focused block)
  showImageUploadDialog() {
    // Create a new image block after the currently focused block (at cursor)
    const afterBlockId = this.focusedBlockId || null;
    const blockId = this.addBlock('image', {}, afterBlockId);
    setTimeout(() => {
      this.triggerImageUpload(blockId);
    }, 100);
  }

  // Trigger file input for image upload
  triggerImageUpload(blockId) {
    const input = document.querySelector('.image-block-input[data-block-id="' + blockId + '"]');
    if (input) {
      input.click();
    }
  }

  // Handle image file upload
  async handleImageUpload(input, blockId) {
    const file = input.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be smaller than 10MB');
      return;
    }

    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return;

    // Show loading state
    const blockEl = document.querySelector('[data-block-id="' + blockId + '"]');
    if (blockEl) {
      const content = blockEl.querySelector('.block-content');
      if (content) {
        content.innerHTML = '<div class="image-upload-loading"><div class="loading-spinner"></div><span>Uploading...</span></div>';
      }
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', '/articles/inline');

    try {
      const response = await fetch('/api/admin/media/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok && result.item) {
        // Update block data
        block.data = {
          media_id: result.item.id,
          url: '/media/' + result.item.storage_key,
          alt: result.item.alt_text || result.item.filename,
          caption: '',
          width: result.item.width || 0,
          height: result.item.height || 0,
          alignment: 'center',
        };

        this.renderBlocks();
        this.focusBlock(blockId);
        this.saveToInput();

        if (window.showToast) {
          window.showToast('Image uploaded', 'success');
        }
      } else {
        alert('Error: ' + (result.error || 'Failed to upload image'));
        this.renderBlocks();
      }
    } catch (err) {
      console.error('Image upload failed:', err);
      alert('Error: Failed to upload image');
      this.renderBlocks();
    }

    // Reset input
    input.value = '';
  }

  // Update image caption
  updateImageCaption(blockId, caption) {
    const block = this.blocks.find(b => b.id === blockId);
    if (block && block.type === 'image') {
      block.data.caption = caption;
      this.saveToInput();
    }
  }

  // Update image alignment
  updateImageAlignment(blockId, alignment) {
    const block = this.blocks.find(b => b.id === blockId);
    if (block && block.type === 'image') {
      block.data.alignment = alignment;
      this.renderBlocks();
      this.focusBlock(blockId);
      this.saveToInput();
    }
  }

  // Show image settings modal
  showImageSettings(blockId) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block || block.type !== 'image') return;

    const altText = prompt('Alt text (for accessibility):', block.data.alt || '');
    if (altText !== null) {
      block.data.alt = altText;
      this.saveToInput();
    }
  }

  // Show AI image generation dialog
  showAIImageDialog(existingBlockId = null) {
    // Store the focused block ID for cursor position insertion (before modal opens and loses focus)
    const insertAfterBlockId = existingBlockId ? null : this.focusedBlockId;
    window._aiImageInsertAfterBlockId = insertAfterBlockId;

    // Capture selected text or block content for context
    let selectedText = '';
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      selectedText = selection.toString().trim();
    } else if (this.focusedBlockId) {
      const content = this.getBlockContent(this.focusedBlockId);
      // If it's a list, join items. getBlockContent already handles this.
      selectedText = content;
    }
    window._aiContextSelectedText = selectedText;

    // Get presets from injected data
    const presets = window._inlineAIImagePresets || [];

    // Build preset options HTML
    const presetOptionsHtml = presets.length > 0
      ? presets.map(p => '<option value="' + p.id + '" data-variables=\\'' + JSON.stringify(p.variables_schema || []).replace(/'/g, '&apos;') + '\\'>' + this.escapeHtml(p.name) + '</option>').join('')
      : '';

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'ai-image-modal-overlay';
    overlay.innerHTML = \`
      <div class="ai-image-modal">
        <div class="ai-image-modal-header">
          <h3>✨ Generate Image with AI</h3>
          <button type="button" class="ai-image-modal-close" onclick="this.closest('.ai-image-modal-overlay').remove()">×</button>
        </div>
        <div class="ai-image-modal-body">
          \${presets.length > 0 ? \`
          <div class="ai-image-form-group">
            <label for="ai-image-preset">Image Preset</label>
            <select id="ai-image-preset" class="ai-image-select" onchange="window.blockEditor.onInlinePresetSelect(this.value)">
              <option value="">No preset (custom prompt)</option>
              \${presetOptionsHtml}
            </select>
            <small class="ai-image-form-help">Select a preset for optimized image generation</small>
          </div>
          <div id="ai-image-variables-section" class="ai-image-variables-section" style="display: none;">
            <div id="ai-image-variables-container"></div>
          </div>
          <!-- Preset Info & Prompt Preview -->
          <div id="ai-image-preset-info-section" class="ai-image-preset-info-section" style="display: none;">
            <div class="ai-image-preset-info">
              <span class="ai-image-info-label">Model:</span>
              <span id="ai-image-model-display" class="ai-image-info-value">-</span>
            </div>
            <div class="ai-image-prompt-preview-section" id="ai-image-prompt-preview-section">
              <div class="ai-image-prompt-preview-header" onclick="window.blockEditor.toggleInlinePromptPreview()">
                <span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  Prompt Preview
                </span>
                <svg class="ai-image-prompt-toggle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <div id="ai-image-prompt-preview-body" class="ai-image-prompt-preview-body">
                <div class="ai-image-prompt-preview-content">
                  <div class="ai-image-prompt-block" id="ai-image-system-prompt-preview" style="display: none;">
                    <div class="ai-image-prompt-label">System Prompt:</div>
                    <div class="ai-image-prompt-text" id="ai-image-system-prompt-text"></div>
                  </div>
                  <div class="ai-image-prompt-block" id="ai-image-user-prompt-preview">
                    <div class="ai-image-prompt-label">Image Prompt:</div>
                    <div class="ai-image-prompt-text" id="ai-image-user-prompt-text"></div>
                  </div>
                </div>
                <div class="ai-image-prompt-unresolved" id="ai-image-unresolved-vars" style="display: none;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                  <span id="ai-image-unresolved-vars-text"></span>
                </div>
              </div>
            </div>
          </div>
          \` : ''}
          <div class="ai-image-form-group">
            <label for="ai-image-prompt">Describe the image you want</label>
            <textarea id="ai-image-prompt" class="ai-image-prompt-input" rows="3" placeholder="A beautiful sunset over mountains with orange and purple sky..."></textarea>
          </div>
          <div class="ai-image-options">
            <div class="ai-image-form-group">
              <label for="ai-image-size">Size</label>
              <select id="ai-image-size" class="ai-image-select">
                <option value="1024x1024">Square (1024×1024)</option>
                <option value="1792x1024">Landscape (1792×1024)</option>
                <option value="1024x1792">Portrait (1024×1792)</option>
              </select>
            </div>
            <div class="ai-image-form-group">
              <label for="ai-image-style">Style</label>
              <select id="ai-image-style" class="ai-image-select">
                <option value="natural">Natural</option>
                <option value="vivid">Vivid</option>
              </select>
            </div>
            <div class="ai-image-form-group">
              <label for="ai-image-quality">Quality</label>
              <select id="ai-image-quality" class="ai-image-select">
                <option value="standard">Standard</option>
                <option value="hd">HD</option>
              </select>
            </div>
          </div>
          <div class="ai-image-preview-container" id="ai-image-preview-container" style="display: none;">
            <img id="ai-image-preview" src="" alt="AI Generated Preview" />
            <p class="ai-image-revised-prompt" id="ai-image-revised-prompt"></p>
          </div>
        </div>
        <div class="ai-image-modal-footer">
          <button type="button" class="btn btn-secondary" onclick="this.closest('.ai-image-modal-overlay').remove()">Cancel</button>
          <button type="button" class="btn btn-primary ai-image-generate-btn" id="ai-image-generate-btn" onclick="window.blockEditor.generateAIImage('\${existingBlockId || ''}')">
            <span class="ai-image-btn-text">Generate Image</span>
            <span class="ai-image-btn-loading" style="display: none;">Generating...</span>
          </button>
          <button type="button" class="btn btn-success ai-image-insert-btn" id="ai-image-insert-btn" style="display: none;" onclick="window.blockEditor.insertAIGeneratedImage('\${existingBlockId || ''}')">Insert to Editor</button>
        </div>
      </div>
    \`;

    document.body.appendChild(overlay);

    // Pre-fill prompt with article context or selected text
    const articleTitle = document.getElementById('title')?.value || '';
    const categorySelect = document.getElementById('category_id');
    const categoryName = categorySelect?.options[categorySelect.selectedIndex]?.text || '';
    const promptInput = document.getElementById('ai-image-prompt');

    if (promptInput && !promptInput.value) {
      if (window._aiContextSelectedText) {
        promptInput.value = window._aiContextSelectedText;
      } else if (articleTitle) {
        promptInput.value = 'An image for an article titled "' + articleTitle + '"' + (categoryName ? ' in the ' + categoryName + ' category' : '');
      }
    }

    // Focus prompt input and add listener for prompt preview updates
    setTimeout(() => {
      if (promptInput) {
        promptInput.focus();
        // Update prompt preview when typing
        promptInput.addEventListener('input', () => this.updateInlinePromptPreview());
      }
    }, 100);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Close on Escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  // Handle preset selection for inline AI image generation
  async onInlinePresetSelect(presetId) {
    const variablesSection = document.getElementById('ai-image-variables-section');
    const variablesContainer = document.getElementById('ai-image-variables-container');
    const presetInfoSection = document.getElementById('ai-image-preset-info-section');

    if (!variablesSection || !variablesContainer) return;

    if (!presetId) {
      variablesSection.style.display = 'none';
      variablesContainer.innerHTML = '';
      if (presetInfoSection) presetInfoSection.style.display = 'none';
      window._currentInlinePresetData = null;
      return;
    }

    // Fetch full preset data from API for prompt preview
    try {
      const response = await fetch('/api/admin/ai/presets/' + presetId);
      const data = await response.json();
      if (data.item) {
        window._currentInlinePresetData = data.item;
        // Show preset info section
        if (presetInfoSection) presetInfoSection.style.display = 'block';
        // Update model display
        const modelDisplay = document.getElementById('ai-image-model-display');
        if (modelDisplay) modelDisplay.textContent = data.item.model_image || 'gpt-image-1';
        // Update prompt preview
        this.updateInlinePromptPreview();
      }
    } catch (err) {
      console.error('Failed to fetch preset:', err);
      window._currentInlinePresetData = null;
      if (presetInfoSection) presetInfoSection.style.display = 'none';
    }

    // Get variables from the selected option's data attribute
    const selectEl = document.getElementById('ai-image-preset');
    const selectedOption = selectEl?.options[selectEl.selectedIndex];
    let variables = [];
    try {
      variables = JSON.parse(selectedOption?.dataset?.variables || '[]');
    } catch (e) {
      variables = [];
    }

    if (variables.length === 0) {
      variablesSection.style.display = 'none';
      variablesContainer.innerHTML = '';
      return;
    }

    // Render variable inputs with oninput handler for real-time preview
    variablesContainer.innerHTML = variables.map(v => \`
      <div class="ai-image-form-group" style="margin-bottom: 12px;">
        <label class="ai-image-variable-label">
          \${this.escapeHtml(v.key)}\${v.required ? ' *' : ''}
          \${v.description ? '<span class="ai-image-variable-desc"> - ' + this.escapeHtml(v.description) + '</span>' : ''}
        </label>
        <input
          type="text"
          class="ai-image-variable-input"
          data-key="\${this.escapeHtml(v.key)}"
          value="\${this.escapeHtml(v.defaultValue || '')}"
          placeholder="\${this.escapeHtml(v.description || '')}"
          \${v.required ? 'required' : ''}
          oninput="window.blockEditor.updateInlinePromptPreview()"
        />
      </div>
    \`).join('');

    variablesSection.style.display = 'block';
  }

  // Toggle prompt preview collapse
  toggleInlinePromptPreview() {
    const section = document.getElementById('ai-image-prompt-preview-section');
    if (section) section.classList.toggle('collapsed');
  }

  // Format prompt text with variable highlighting
  formatInlinePromptText(text, contextVars, customVars) {
    if (!text) return '';

    // Escape HTML
    let formatted = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Replace and highlight resolved variables
    const allVars = { ...contextVars, ...customVars };
    for (const [key, value] of Object.entries(allVars)) {
      if (value) {
        const regex = new RegExp(\`\\\\{\\\\{\${key}\\\\}\\\\}\`, 'g');
        formatted = formatted.replace(regex, '<span class="var-resolved">' + this.escapeHtml(String(value)) + '</span>');
      }
    }

    // Highlight unresolved variables
    formatted = formatted.replace(/\\{\\{([a-z_]+)\\}\\}/g, '<span class="var-unresolved">{{$1}}</span>');

    return formatted;
  }

  // Update the prompt preview display
  updateInlinePromptPreview() {
    const previewSection = document.getElementById('ai-image-prompt-preview-section');
    const presetData = window._currentInlinePresetData;

    if (!presetData) {
      if (previewSection) previewSection.style.display = 'none';
      return;
    }

    const systemTemplate = presetData.system_prompt_template || '';
    const userTemplate = presetData.user_prompt_template || '';
    const customPrompt = document.getElementById('ai-image-prompt')?.value || '';

    // Get context values
    const contextVars = {
      article_title: document.getElementById('title')?.value || '',
      article_excerpt: document.getElementById('excerpt')?.value || '',
      category_name: document.getElementById('category_id')?.selectedOptions[0]?.text || '',
      selected_text: window._aiContextSelectedText || '',
      prompt: customPrompt
    };

    // Get custom variables from modal inputs
    const customVars = {};
    document.querySelectorAll('.ai-image-variable-input').forEach(input => {
      const key = input.dataset.key;
      if (key) customVars[key] = input.value || '';
    });

    // Show system prompt if exists
    const systemBlock = document.getElementById('ai-image-system-prompt-preview');
    const systemText = document.getElementById('ai-image-system-prompt-text');
    if (systemTemplate && systemBlock && systemText) {
      systemText.innerHTML = this.formatInlinePromptText(systemTemplate, contextVars, customVars);
      systemBlock.style.display = 'block';
    } else if (systemBlock) {
      systemBlock.style.display = 'none';
    }

    // Show user prompt
    const userText = document.getElementById('ai-image-user-prompt-text');
    const fullUserPrompt = userTemplate || '(No prompt template - using custom description only)';
    if (userText) {
      userText.innerHTML = this.formatInlinePromptText(fullUserPrompt, contextVars, customVars);
    }

    // Collect unresolved variables
    const allUnresolved = [];
    const unresolvedRegex = /\\{\\{([a-z_]+)\\}\\}/g;
    let match;
    const combinedText = systemTemplate + ' ' + userTemplate;
    const allVars = { ...contextVars, ...customVars };
    while ((match = unresolvedRegex.exec(combinedText)) !== null) {
      const varName = match[1];
      if (!allVars[varName]) {
        allUnresolved.push(varName);
      }
    }

    const unresolvedSection = document.getElementById('ai-image-unresolved-vars');
    const unresolvedText = document.getElementById('ai-image-unresolved-vars-text');
    if (allUnresolved.length > 0 && unresolvedSection && unresolvedText) {
      unresolvedText.textContent = 'Unresolved variables: ' + [...new Set(allUnresolved)].join(', ');
      unresolvedSection.style.display = 'flex';
    } else if (unresolvedSection) {
      unresolvedSection.style.display = 'none';
    }

    if (previewSection) previewSection.style.display = 'block';
  }

  // Generate AI image
  async generateAIImage(existingBlockId) {
    const prompt = document.getElementById('ai-image-prompt')?.value?.trim();
    const presetId = document.getElementById('ai-image-preset')?.value;

    if (!prompt && !presetId) {
      alert('Please enter a description or select a preset');
      return;
    }

    const size = document.getElementById('ai-image-size')?.value || '1024x1024';
    const style = document.getElementById('ai-image-style')?.value || 'natural';
    const quality = document.getElementById('ai-image-quality')?.value || 'standard';

    // Collect variables from variable inputs
    const variables = {};
    const variableInputs = document.querySelectorAll('.ai-image-variable-input');
    variableInputs.forEach(input => {
      if (input.value) {
        variables[input.dataset.key] = input.value;
      }
    });

    // Add article context to variables
    const articleTitle = document.getElementById('title')?.value || '';
    const categorySelect = document.getElementById('category_id');
    const categoryName = categorySelect?.options[categorySelect.selectedIndex]?.text || '';
    variables.article_title = articleTitle;
    variables.category_name = categoryName;
    if (window._aiContextSelectedText) {
      variables.selected_text = window._aiContextSelectedText;
    }

    const generateBtn = document.getElementById('ai-image-generate-btn');
    const btnText = generateBtn?.querySelector('.ai-image-btn-text');
    const btnLoading = generateBtn?.querySelector('.ai-image-btn-loading');
    const previewContainer = document.getElementById('ai-image-preview-container');
    const previewImg = document.getElementById('ai-image-preview');
    const revisedPromptEl = document.getElementById('ai-image-revised-prompt');
    const insertBtn = document.getElementById('ai-image-insert-btn');

    // Show loading state
    if (generateBtn) generateBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline';
    if (previewContainer) previewContainer.style.display = 'none';
    if (insertBtn) insertBtn.style.display = 'none';

    try {
      const response = await fetch('/api/admin/ai/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt || 'Generate an image',
          presetId: presetId ? parseInt(presetId) : undefined,
          variables,
          size,
          style,
          quality,
          saveToMedia: true,
          altText: articleTitle ? 'Image for: ' + articleTitle : (prompt ? prompt.substring(0, 100) : 'AI generated image'),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to generate image');
      }

      // Store the result for insertion
      window._aiGeneratedImage = {
        url: result.imageUrl,
        mediaId: result.mediaId,
        revisedPrompt: result.revisedPrompt,
        size,
      };

      // Show preview
      if (previewImg) {
        previewImg.src = result.imageUrl;
        previewImg.alt = result.revisedPrompt || prompt;
      }
      if (revisedPromptEl && result.revisedPrompt) {
        revisedPromptEl.textContent = result.revisedPrompt;
      }
      if (previewContainer) previewContainer.style.display = 'block';
      if (insertBtn) insertBtn.style.display = 'inline-flex';

      if (window.showToast) {
        window.showToast('Image generated!', 'success');
        // Show warning if media save failed
        if (result.warning) {
          window.showToast(result.warning, 'warning');
        }
      }

    } catch (err) {
      console.error('AI image generation failed:', err);
      if (window.showToast) {
        window.showToast('AI Error: ' + (err.message || 'Failed to generate image'), 'error');
      } else {
        alert('AI Error: ' + (err.message || 'Failed to generate image'));
      }
    } finally {
      // Reset button state
      if (generateBtn) generateBtn.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnLoading) btnLoading.style.display = 'none';
    }
  }

  // Insert AI generated image into editor
  insertAIGeneratedImage(existingBlockId) {
    const imageData = window._aiGeneratedImage;
    if (!imageData) {
      if (window.showToast) {
        window.showToast('No image to insert', 'warning');
      } else {
        alert('No image to insert');
      }
      return;
    }

    // Parse dimensions from size
    const [width, height] = (imageData.size || '1024x1024').split('x').map(Number);

    const blockData = {
      media_id: imageData.mediaId || null,
      url: imageData.url,
      alt: imageData.revisedPrompt || 'AI generated image',
      caption: '',
      width: width,
      height: height,
      alignment: 'center',
    };

    if (existingBlockId) {
      // Update existing block
      const block = this.blocks.find(b => b.id === existingBlockId);
      if (block) {
        block.data = blockData;
        this.renderBlocks();
        this.focusBlock(existingBlockId);
        this.saveToInput();
      }
    } else {
      // Create new image block at cursor position (after the previously focused block)
      const insertAfterBlockId = window._aiImageInsertAfterBlockId || null;
      this.addBlock('image', blockData, insertAfterBlockId);
    }

    // Close modal
    const overlay = document.querySelector('.ai-image-modal-overlay');
    if (overlay) overlay.remove();

    // Clear stored data
    window._aiGeneratedImage = null;
    window._aiImageInsertAfterBlockId = null;

    if (window.showToast) {
      window.showToast('Image inserted', 'success');
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Sanitize HTML - allow only safe formatting tags
  sanitizeHtml(html) {
    if (!html) return '';

    // Create a temporary element to parse the HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Allowed tags (whitelist)
    const allowedTags = ['strong', 'b', 'em', 'i', 'a', 'br'];

    // Recursive function to sanitize nodes
    const sanitizeNode = (node) => {
      const result = [];

      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          // Text nodes are safe
          result.push(this.escapeHtml(child.textContent || ''));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tagName = child.tagName.toLowerCase();

          if (allowedTags.includes(tagName)) {
            // Tag is allowed
            if (tagName === 'br') {
              result.push('<br>');
            } else if (tagName === 'a') {
              // For links, only preserve href attribute
              const href = child.getAttribute('href');
              if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('/'))) {
                const safeHref = this.escapeHtml(href);
                const innerContent = sanitizeNode(child);
                result.push('<a href="' + safeHref + '">' + innerContent + '</a>');
              } else {
                // Invalid or suspicious href, just output the content without link
                result.push(sanitizeNode(child));
              }
            } else {
              // strong, b, em, i - just wrap the content
              const innerContent = sanitizeNode(child);
              result.push('<' + tagName + '>' + innerContent + '</' + tagName + '>');
            }
          } else {
            // Tag not allowed - output its text content only (recursive)
            result.push(sanitizeNode(child));
          }
        }
      }

      return result.join('');
    };

    return sanitizeNode(temp);
  }

  // Migrate legacy markdown syntax to HTML when loading content
  // Note: Process bold first, then italic to avoid conflicts
  migrateMarkdownToHtml(text) {
    if (!text) return '';

    // Convert **text** to <strong>text</strong> (bold - process first)
    let result = text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

    // Convert *text* to <em>text</em> (italic - exclude if inside tags)
    result = result.replace(/\\*([^*<>]+)\\*/g, '<em>$1</em>');

    // Convert [text](url) to <a href="url">text</a>
    result = result.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');

    return result;
  }

  // Setup event listeners for a block
  setupBlockEvents(wrapper, block, content) {
    // Focus tracking - but don't override if clicking on an editable element
    wrapper.addEventListener('click', (e) => {
      // Check if click target is or is inside a contenteditable element
      const target = e.target;
      const isEditable = target.closest && target.closest('[contenteditable="true"]');
      // Only call focusBlock for visual state update, but don't re-focus if already on editable
      this.focusedBlockId = block.id;
      document.querySelectorAll('.editor-block').forEach(el => {
        el.classList.toggle('focused', el.dataset.blockId === block.id);
      });
      // Show AI toolbar for text blocks
      if (['paragraph', 'heading', 'list', 'quote'].includes(block.type)) {
        this.showBlockAIToolbar(wrapper, block);
      } else {
        this.hideBlockAIToolbar();
      }
      // Only focus first editable if not clicking on an editable element
      if (!isEditable) {
        const editable = wrapper.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.focus();
        }
      }
    });

    // Content changes
    const editables = content.querySelectorAll('[contenteditable="true"]');
    editables.forEach(el => {
      el.addEventListener('input', () => this.handleInput(block, content));
      el.addEventListener('keydown', (e) => this.handleKeydown(e, block));
      el.addEventListener('paste', (e) => this.handlePaste(e));
    });

    // PR-3 (issue 12): the FAQ editor uses real <input>/<textarea> fields (not
    // contenteditable), so wire their 'input' events to the same handleInput
    // path that serializes the rows back into block.data.items.
    if (block.type === 'faqgroup') {
      const faqFields = content.querySelectorAll('.faq-edit-q, .faq-edit-a');
      faqFields.forEach(el => {
        el.addEventListener('input', () => this.handleInput(block, content));
      });
    }

    // Image block drag-and-drop
    if (block.type === 'image') {
      const dropZone = content.querySelector('.image-upload-placeholder') || content.querySelector('.image-block-preview');
      if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('dragover');

          const files = e.dataTransfer.files;
          if (files.length > 0 && files[0].type.startsWith('image/')) {
            const input = content.querySelector('.image-block-input');
            if (input) {
              // Create a DataTransfer to set the files
              const dt = new DataTransfer();
              dt.items.add(files[0]);
              input.files = dt.files;
              this.handleImageUpload(input, block.id);
            }
          }
        });
      }
    }
  }

  // Handle input changes
  handleInput(block, content) {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        const textEl = content.querySelector('.editable-text');
        block.data.text = textEl ? textEl.textContent || '' : '';
        break;
      case 'list':
        const listItems = content.querySelectorAll('.list-item-input');
        let newItems = [];
        let needsRerender = false;

        Array.from(listItems).forEach(item => {
          const html = item.innerHTML || '';
          // Check if item contains <br> tags (from Shift+Enter)
          if (/<br\\s*\\/?>/i.test(html)) {
            // Split by <br> tags
            const SPLIT_MARKER = '|||SPLIT|||';
            let text = html.replace(/<br\\s*\\/?>/gi, SPLIT_MARKER);
            text = text.replace(/<[^>]+>/g, ''); // Strip other HTML
            const parts = text.split(SPLIT_MARKER).map(t => t.trim()).filter(t => t);
            newItems.push(...parts);
            needsRerender = true;
          } else {
            newItems.push(item.textContent || '');
          }
        });

        block.data.items = newItems.length > 0 ? newItems : [''];

        // Re-render if we split items
        if (needsRerender) {
          const lastItemIndex = newItems.length - 1;
          this.renderBlocks();
          this.focusBlock(block.id);
          // Focus the last list item (where user was typing)
          setTimeout(() => {
            const blockEl = document.querySelector('[data-block-id="' + block.id + '"]');
            if (blockEl) {
              const lastItem = blockEl.querySelector('[data-item-index="' + lastItemIndex + '"]');
              if (lastItem) {
                lastItem.focus();
                // Move cursor to end
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(lastItem);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            }
          }, 0);
        }
        break;
      case 'quote':
        const quoteText = content.querySelector('.quote-text');
        const quoteCaption = content.querySelector('.quote-caption');
        block.data.text = quoteText ? quoteText.textContent || '' : '';
        block.data.caption = quoteCaption ? quoteCaption.textContent || '' : '';
        break;
      case 'pullquote':
        const pullquoteText = content.querySelector('.pullquote-text');
        block.data.text = pullquoteText ? pullquoteText.textContent || '' : '';
        break;
      case 'faqgroup':
        this.readFaqRows(block, content);
        break;
    }
    this.saveToInput();
  }

  // Handle keydown events
  handleKeydown(e, block) {
    // Enter key handling
    if (e.key === 'Enter' && !e.shiftKey) {
      if (block.type === 'paragraph' || block.type === 'heading') {
        e.preventDefault();
        // Create new paragraph after this block
        this.addBlock('paragraph', {}, block.id);
      } else if (block.type === 'list') {
        // Check if we're at the end of an empty list item
        const selection = window.getSelection();
        if (selection && selection.anchorNode) {
          const listItem = selection.anchorNode.parentElement;
          if (listItem && listItem.classList.contains('list-item-input')) {
            const text = listItem.textContent || '';
            if (text === '') {
              e.preventDefault();
              // Convert to paragraph and exit list
              this.addBlock('paragraph', {}, block.id);
              // Remove empty item from list
              const index = parseInt(listItem.dataset.itemIndex || '0');
              block.data.items.splice(index, 1);
              if (block.data.items.length === 0) {
                this.deleteBlock(block.id);
              } else {
                this.renderBlocks();
              }
              return;
            }
          }
        }
        // Add new list item - let browser handle it
      }
    }

    // Backspace at start of block
    if (e.key === 'Backspace') {
      const selection = window.getSelection();
      if (selection && selection.isCollapsed && selection.anchorOffset === 0) {
        const target = e.target;
        const text = target.textContent || '';

        if (text === '' && block.type !== 'paragraph') {
          e.preventDefault();
          // Convert to paragraph
          this.convertBlock('paragraph');
        } else if (text === '' && this.blocks.length > 1) {
          e.preventDefault();
          this.deleteBlock(block.id);
        }
      }
    }
  }

  // Handle paste - strip formatting
  handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  // Focus a block
  focusBlock(id) {
    this.focusedBlockId = id;

    // Update visual state
    document.querySelectorAll('.editor-block').forEach(el => {
      el.classList.toggle('focused', el.dataset.blockId === id);
    });

    // Focus the editable element
    const blockEl = document.querySelector('[data-block-id="' + id + '"]');
    if (blockEl) {
      const editable = blockEl.querySelector('[contenteditable="true"]');
      if (editable) {
        editable.focus();
      }
      // Show block AI actions toolbar for text-based blocks
      const block = this.blocks.find(b => b.id === id);
      if (block && ['paragraph', 'heading', 'list', 'quote'].includes(block.type)) {
        this.showBlockAIToolbar(blockEl, block);
      } else {
        this.hideBlockAIToolbar();
      }
    }
  }

  // Show block AI actions toolbar
  showBlockAIToolbar(blockEl, block) {
    // Remove existing toolbar
    this.hideBlockAIToolbar();

    // Create toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'block-ai-toolbar';
    toolbar.id = 'blockAIToolbar';
    toolbar.dataset.blockId = block.id;

    toolbar.innerHTML = \`
      <span class="block-ai-toolbar-label">AI:</span>
      <button type="button" class="block-ai-btn" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_improve_quality')" title="Improve quality - fix grammar, enhance clarity">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        Improve
      </button>
      <button type="button" class="block-ai-btn" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_expand')" title="Expand - add more detail and examples">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
        Expand
      </button>
      <button type="button" class="block-ai-btn" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_improve_seo')" title="Improve SEO - add keywords naturally">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        SEO
      </button>
      <div class="block-ai-tone-dropdown">
        <button type="button" class="block-ai-btn" onclick="this.parentElement.classList.toggle('open')" title="Rewrite in different tone">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          Tone
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 2px;">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <div class="block-ai-tone-menu">
          <button type="button" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_rewrite_tone', 'professional')">Professional</button>
          <button type="button" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_rewrite_tone', 'casual')">Casual</button>
          <button type="button" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_rewrite_tone', 'friendly')">Friendly</button>
          <button type="button" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_rewrite_tone', 'authoritative')">Authoritative</button>
          <button type="button" onclick="window.blockEditor.runBlockAIAction('\${block.id}', 'block_rewrite_tone', 'conversational')">Conversational</button>
        </div>
      </div>
    \`;

    // Position toolbar at top of block
    blockEl.appendChild(toolbar);

    // Close dropdown when clicking outside
    setTimeout(() => {
      document.addEventListener('click', this._closeBlockAIDropdown);
    }, 0);
  }

  // Hide block AI actions toolbar
  hideBlockAIToolbar() {
    const existing = document.getElementById('blockAIToolbar');
    if (existing) {
      existing.remove();
    }
    document.removeEventListener('click', this._closeBlockAIDropdown);
  }

  // Close dropdown handler
  _closeBlockAIDropdown = (e) => {
    const dropdown = document.querySelector('.block-ai-tone-dropdown.open');
    if (dropdown && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  }

  // Get block content as text
  getBlockContent(blockId) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return '';

    switch (block.type) {
      case 'paragraph':
      case 'heading':
        return block.data.text || '';
      case 'list':
        return (block.data.items || []).join('\\n');
      case 'quote':
        let text = block.data.text || '';
        if (block.data.caption) {
          text += '\\n— ' + block.data.caption;
        }
        return text;
      default:
        return '';
    }
  }

  // Run block AI action
  async runBlockAIAction(blockId, action, tone = null) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return;

    // Close any open dropdowns
    document.querySelectorAll('.block-ai-tone-dropdown.open').forEach(el => el.classList.remove('open'));

    const blockContent = this.getBlockContent(blockId);
    if (!blockContent.trim()) {
      if (window.showToast) {
        window.showToast('Block is empty', 'error');
      }
      return;
    }

    // Get article context
    const title = document.getElementById('title')?.value || '';
    const categorySelect = document.getElementById('category_id');
    const categoryName = categorySelect?.options[categorySelect.selectedIndex]?.text || '';

    // Show loading state on the block
    const blockEl = document.querySelector('[data-block-id="' + blockId + '"]');
    if (blockEl) {
      blockEl.classList.add('ai-processing');
    }

    try {
      const response = await fetch('/api/admin/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: action,
          context: {
            articleTitle: title,
            categoryName: categoryName,
            blockContent: blockContent,
            blockType: block.type,
          },
          options: {
            tone: tone || undefined,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'AI generation failed');
      }

      // Apply the result to the block
      if (data.content) {
        this.applyAIResultToBlock(blockId, data.content, block.type);
        if (window.showToast) {
          window.showToast('Content updated', 'success');
        }
      }

    } catch (err) {
      console.error('Block AI action failed:', err);
      if (window.showToast) {
        window.showToast('Error: ' + err.message, 'error');
      }
    } finally {
      if (blockEl) {
        blockEl.classList.remove('ai-processing');
      }
    }
  }

  // Apply AI result to block
  applyAIResultToBlock(blockId, content, blockType) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return;

    // Clean up the content
    let cleanContent = content.trim();

    // Remove any markdown formatting that might have been added
    // but preserve the text structure for lists
    if (blockType === 'list') {
      // Split into list items
      const lines = cleanContent.split('\\n').filter(l => l.trim());
      const items = lines.map(line => {
        // Remove common list prefixes
        return line.replace(/^[-*•\\d+.]+\\s*/, '').trim();
      }).filter(item => item);
      block.data.items = items.length > 0 ? items : [''];
    } else if (blockType === 'quote') {
      // Handle quote - might have attribution
      const lines = cleanContent.split('\\n').filter(l => l.trim());
      if (lines.length > 1 && lines[lines.length - 1].startsWith('—')) {
        block.data.text = lines.slice(0, -1).join(' ');
        block.data.caption = lines[lines.length - 1].replace(/^—\\s*/, '');
      } else {
        block.data.text = cleanContent;
      }
    } else {
      // Paragraph or heading - just set the text
      block.data.text = cleanContent;
    }

    this.renderBlocks();
    this.focusBlock(blockId);
    this.saveToInput();
  }

  // Save to hidden input
  saveToInput() {
    const content = {
      version: 1,
      blocks: this.blocks.map(b => ({
        id: b.id,
        type: b.type,
        data: b.data
      }))
    };

    const input = document.getElementById(this.options.hiddenInputId);
    if (input) {
      input.value = JSON.stringify(content, null, 2);
    }

    if (this.options.onChange) {
      this.options.onChange(content);
    }
  }

  // Load from hidden input
  loadFromInput() {
    const input = document.getElementById(this.options.hiddenInputId);
    if (!input || !input.value) return;

    try {
      const content = JSON.parse(input.value);
      if (content && content.blocks && Array.isArray(content.blocks)) {
        this.blocks = content.blocks.map(b => ({
          id: b.id || this.generateId(),
          type: b.type,
          data: b.data || {}
        }));
        this.renderBlocks();
      }
    } catch (err) {
      console.error('Failed to load editor content:', err);
    }
  }

  // Setup auto-save
  setupAutoSave() {
    // Save on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.saveToInput();
      }
    });
  }

  // Get content as JSON
  getContent() {
    return {
      version: 1,
      blocks: this.blocks
    };
  }

  // Set content from JSON
  setContent(content) {
    if (content && content.blocks && Array.isArray(content.blocks)) {
      this.blocks = content.blocks.map(b => ({
        id: b.id || this.generateId(),
        type: b.type,
        data: b.data || {}
      }));
      this.renderBlocks();
      this.saveToInput();
    }
  }
}

// =============================================================================
// Initialize Editor
// =============================================================================

function initBlockEditor(containerId, options = {}) {
  window.blockEditor = new BlockEditor(containerId, options);
  return window.blockEditor;
}

// Refresh the block editor display (used by AI assistant)
window.refreshBlockEditor = function() {
  if (window.blockEditor) {
    window.blockEditor.loadFromInput();
  }
};
`;

/**
 * Editor CSS styles for embedding in HTML
 */
export const editorStyles = `
/* Block Editor Container */
.block-editor {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  overflow: hidden;
}

/* Toolbar */
.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
  background: var(--color-bg-alt);
  border-bottom: 1px solid var(--color-border);
  z-index: 100;
}

.editor-toolbar.toolbar-fixed {
  position: fixed;
  top: 0;
  left: auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.toolbar-placeholder {
  flex-shrink: 0;
}

.toolbar-btn {
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 4px;
}

.toolbar-divider-ai {
  width: 2px;
  margin: 0 12px;
  background: linear-gradient(180deg, transparent, var(--color-primary), transparent);
}

.toolbar-btn-ai {
  background: linear-gradient(135deg, #f0e6ff 0%, #e6f0ff 100%);
  border-color: var(--color-primary);
}

.toolbar-btn-ai:hover {
  background: linear-gradient(135deg, #e0d0ff 0%, #d0e0ff 100%);
}

/* Blocks Container */
.editor-blocks {
  min-height: 300px;
  padding: 16px;
}

/* Individual Block */
.editor-block {
  position: relative;
  padding: 8px 8px 8px 32px;
  margin-bottom: 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.editor-block:hover {
  background: var(--color-bg-alt);
}

.editor-block.focused {
  background: var(--color-primary-light);
}

/* Block Controls */
.block-controls {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s;
}

.editor-block:hover .block-controls,
.editor-block.focused .block-controls {
  opacity: 1;
}

.block-control-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 12px;
  line-height: 1;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  color: var(--color-text-muted);
}

.block-control-btn:hover {
  background: var(--color-bg-dark);
  color: var(--color-text);
}

.block-control-btn.delete:hover {
  background: var(--color-error);
  border-color: var(--color-error);
  color: white;
}

/* Block Content */
.block-content {
  outline: none;
}

.block-content .editable-text {
  outline: none;
  min-height: 1.5em;
}

.block-content .editable-text:empty::before {
  content: attr(data-placeholder);
  color: var(--color-text-muted);
  pointer-events: none;
}

/* Headings */
.block-content .heading-1 {
  font-size: 28px;
  font-weight: 700;
  margin: 0;
}

.block-content .heading-2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
}

.block-content .heading-3 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.block-content .heading-4 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

/* Lists */
.block-content .editable-list {
  margin: 0;
  padding-left: 24px;
}

.block-content .editable-list li {
  margin-bottom: 4px;
}

.block-content .list-item-input {
  outline: none;
  min-width: 1px;
}

.block-content .list-item-input:empty::before {
  content: 'List item...';
  color: var(--color-text-muted);
}

/* Quote */
.block-content .quote-wrapper {
  margin: 0;
  padding: 12px 16px;
  border-left: 4px solid var(--color-primary);
  background: var(--color-bg-alt);
  border-radius: 0 4px 4px 0;
}

.block-content .quote-text {
  font-style: italic;
  font-size: 16px;
  margin-bottom: 8px;
}

.block-content .quote-caption {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* PR-3: Key idea (pull-quote) editor */
.block-content .pullquote-wrapper {
  margin: 0;
  padding: 12px 16px;
  border-left: 4px solid var(--color-primary);
  background: var(--color-bg-alt);
  border-radius: 0 4px 4px 0;
}

.block-content .pullquote-text {
  font-weight: 700;
  font-size: 18px;
}

/* PR-3: FAQ group editor */
.block-content .faq-edit {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-content .faq-edit-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: start;
}

.block-content .faq-edit-q,
.block-content .faq-edit-a {
  width: 100%;
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-sizing: border-box;
}

.block-content .faq-edit-q {
  font-weight: 700;
  grid-column: 1;
}

.block-content .faq-edit-a {
  grid-column: 1;
  resize: vertical;
}

.block-content .faq-edit-remove {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: start;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  width: 32px;
  height: 32px;
  line-height: 1;
  font-size: 18px;
}

.block-content .faq-edit-remove:hover {
  color: #c0392b;
  border-color: #c0392b;
}

.block-content .faq-edit-add {
  align-self: flex-start;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-primary);
  cursor: pointer;
  padding: 6px 12px;
  font: inherit;
}

/* Divider */
.block-content .divider-preview {
  border: none;
  border-top: 2px solid var(--color-border);
  margin: 16px 0;
}

/* Image Block */
.image-block-empty,
.image-block-content {
  border-radius: 8px;
  overflow: hidden;
}

.image-upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  border: 2px dashed var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-alt);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  color: var(--color-text-muted);
}

.image-upload-placeholder:hover,
.image-upload-placeholder.dragover {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.image-upload-placeholder svg {
  margin-bottom: 8px;
  opacity: 0.6;
}

.image-upload-placeholder p {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 500;
}

.image-upload-placeholder small {
  font-size: 12px;
  opacity: 0.7;
}

.image-upload-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: var(--color-bg-alt);
  border-radius: 8px;
  color: var(--color-text-muted);
}

.image-upload-loading .loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.image-block-preview {
  position: relative;
  background: var(--color-bg-alt);
  text-align: center;
}

.image-block-preview img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

.image-block-preview.dragover {
  outline: 2px dashed var(--color-primary);
  outline-offset: -2px;
}

.image-block-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-block-preview:hover .image-block-overlay {
  opacity: 1;
}

.image-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
}

.image-btn:hover {
  background: rgba(0, 0, 0, 0.9);
}

.image-block-caption {
  padding: 8px 0;
}

.image-caption-input {
  width: 100%;
  padding: 8px;
  font-size: 13px;
  font-style: italic;
  text-align: center;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  outline: none;
  color: var(--color-text-muted);
  transition: border-color 0.2s;
}

.image-caption-input:hover,
.image-caption-input:focus {
  border-bottom-color: var(--color-border);
}

.image-caption-input::placeholder {
  color: var(--color-text-muted);
  opacity: 0.6;
}

.image-block-alignment {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 8px 0;
  border-top: 1px solid var(--color-border);
}

.align-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-muted);
  transition: all 0.2s;
}

.align-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.align-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Image alignment classes */
.image-block-content.align-left {
  text-align: left;
}

.image-block-content.align-left .image-block-preview img {
  margin: 0;
}

.image-block-content.align-center {
  text-align: center;
}

.image-block-content.align-right {
  text-align: right;
}

.image-block-content.align-right .image-block-preview img {
  margin: 0 0 0 auto;
}

.image-block-content.align-full .image-block-preview img {
  width: 100%;
}

/* Add Block Button */
.add-block-container {
  position: relative;
  padding: 8px 16px 16px;
  border-top: 1px solid var(--color-border);
}

.add-block-btn {
  width: 100%;
  padding: 12px;
  font-size: 14px;
  color: var(--color-text-muted);
  background: var(--color-bg-alt);
  border: 1px dashed var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.add-block-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* Block Menu */
.block-menu {
  position: absolute;
  bottom: 100%;
  left: 16px;
  right: 16px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 4px;
  z-index: 10;
}

.block-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.block-menu-item:hover {
  background: var(--color-bg-alt);
}

.block-menu-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-alt);
  border-radius: 4px;
  font-weight: 600;
  font-size: 12px;
}

.block-menu-separator {
  grid-column: 1 / -1;
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

/* Image Block Options Row */
.image-options-row {
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 16px;
}

.image-or-divider {
  display: flex;
  align-items: center;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
}

.image-ai-generate-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  border: 2px dashed var(--color-border);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(147, 51, 234, 0.05), rgba(59, 130, 246, 0.05));
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  color: var(--color-text-muted);
}

.image-ai-generate-placeholder:hover {
  border-color: #9333ea;
  background: linear-gradient(135deg, rgba(147, 51, 234, 0.1), rgba(59, 130, 246, 0.1));
  color: #9333ea;
}

.image-ai-generate-placeholder svg {
  margin-bottom: 8px;
  color: #9333ea;
}

.image-ai-generate-placeholder p {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 500;
}

.image-ai-generate-placeholder small {
  font-size: 12px;
  opacity: 0.7;
}

.image-upload-placeholder {
  flex: 1;
}

/* AI Image Modal */
.ai-image-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.ai-image-modal {
  background: var(--color-bg);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ai-image-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(135deg, rgba(147, 51, 234, 0.1), rgba(59, 130, 246, 0.1));
}

.ai-image-modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.ai-image-modal-close {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--color-bg);
  border-radius: 6px;
  font-size: 20px;
  cursor: pointer;
  color: var(--color-text-muted);
  transition: all 0.2s;
}

.ai-image-modal-close:hover {
  background: var(--color-error);
  color: white;
}

.ai-image-modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.ai-image-form-group {
  margin-bottom: 16px;
}

.ai-image-form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.ai-image-prompt-input {
  width: 100%;
  padding: 12px;
  font-size: 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  resize: vertical;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
}

.ai-image-prompt-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.ai-image-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.ai-image-select {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
}

.ai-image-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.ai-image-form-help {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.ai-image-variables-section {
  padding: 12px;
  margin-bottom: 16px;
  background: var(--color-bg-alt);
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.ai-image-variable-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
}

.ai-image-variable-desc {
  font-weight: normal;
  color: var(--color-text-muted);
}

.ai-image-variable-input {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
}

.ai-image-variable-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.ai-image-variable-input::placeholder {
  color: var(--color-text-muted);
}

.ai-image-preview-container {
  margin-top: 16px;
  padding: 16px;
  background: var(--color-bg-alt);
  border-radius: 8px;
  text-align: center;
}

.ai-image-preview-container img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.ai-image-revised-prompt {
  margin: 12px 0 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
  font-style: italic;
}

.ai-image-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-alt);
}

.ai-image-generate-btn,
.ai-image-insert-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ai-image-btn-loading {
  display: none;
}

.ai-image-generate-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

/* Button styles for modal */
.ai-image-modal .btn {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.ai-image-modal .btn-secondary {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.ai-image-modal .btn-secondary:hover {
  background: var(--color-bg-dark);
}

.ai-image-modal .btn-primary {
  background: linear-gradient(135deg, #9333ea, #3b82f6);
  color: white;
}

.ai-image-modal .btn-primary:hover {
  filter: brightness(1.1);
}

.ai-image-modal .btn-success {
  background: var(--color-success);
  color: white;
}

.ai-image-modal .btn-success:hover {
  filter: brightness(1.1);
}

/* AI Image Preset Info & Prompt Preview */
.ai-image-preset-info-section {
  margin-bottom: 16px;
}

.ai-image-preset-info {
  background: var(--color-bg-alt);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-image-info-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.ai-image-info-value {
  font-size: 13px;
  font-family: ui-monospace, monospace;
  color: var(--color-primary, #4f46e5);
  font-weight: 500;
}

.ai-image-prompt-preview-section {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.ai-image-prompt-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--color-bg-alt);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 1px solid var(--color-border);
}

.ai-image-prompt-preview-header span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-image-prompt-toggle {
  transition: transform 0.2s;
}

.ai-image-prompt-preview-section.collapsed .ai-image-prompt-toggle {
  transform: rotate(-90deg);
}

.ai-image-prompt-preview-section.collapsed .ai-image-prompt-preview-body {
  display: none;
}

.ai-image-prompt-preview-body {
  padding: 12px;
  background: var(--color-bg);
}

.ai-image-prompt-block {
  margin-bottom: 12px;
}

.ai-image-prompt-block:last-child {
  margin-bottom: 0;
}

.ai-image-prompt-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  margin-bottom: 4px;
}

.ai-image-prompt-text {
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 10px;
  background: var(--color-bg-alt);
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

.ai-image-prompt-text .var-resolved {
  background: #d1fae5;
  color: #065f46;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 500;
}

.ai-image-prompt-text .var-unresolved {
  background: #fef3c7;
  color: #92400e;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 500;
}

.ai-image-prompt-unresolved {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: #fef3c7;
  border-radius: 4px;
  font-size: 12px;
  color: #92400e;
  margin-top: 8px;
}

.ai-image-prompt-unresolved svg {
  flex-shrink: 0;
  margin-top: 1px;
}

/* Block AI Actions Toolbar */
.block-ai-toolbar {
  position: absolute;
  top: -36px;
  left: 32px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 6px 6px 0 0;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.15);
  z-index: 100;
  opacity: 0;
  transform: translateY(4px);
  animation: blockAIToolbarIn 0.2s ease forwards;
}

@keyframes blockAIToolbarIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.block-ai-toolbar-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 4px;
}

.block-ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
  color: white;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.block-ai-btn:hover {
  background: rgba(255, 255, 255, 0.25);
}

.block-ai-btn:active {
  background: rgba(255, 255, 255, 0.35);
  transform: scale(0.98);
}

.block-ai-btn svg {
  flex-shrink: 0;
}

/* Tone Dropdown */
.block-ai-tone-dropdown {
  position: relative;
}

.block-ai-tone-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  padding: 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: none;
  flex-direction: column;
  min-width: 140px;
  z-index: 110;
}

.block-ai-tone-dropdown.open .block-ai-tone-menu {
  display: flex;
}

.block-ai-tone-menu button {
  padding: 8px 12px;
  font-size: 13px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text);
  transition: background 0.15s;
}

.block-ai-tone-menu button:hover {
  background: var(--color-bg-alt);
}

/* Block processing state */
.editor-block.ai-processing {
  position: relative;
  pointer-events: none;
}

.editor-block.ai-processing::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.editor-block.ai-processing::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  z-index: 10;
}
`;
