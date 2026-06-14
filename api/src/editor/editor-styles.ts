// Block editor UI stylesheet (T27 [B6] port). Exported as a plain CSS
// string; editor-scripts.ts embeds it (JSON-stringified) into the client
// script, which injects a <style id="block-editor-styles"> tag at mount
// time. Nothing here is ES6 JS — it is CSS text only — but it still ends
// up inside the script string, so it must not contain the substrings the
// ES5 contract forbids in the script literal.

export const EDITOR_CSS = `
.block-editor { border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; margin-bottom: 12px; }
.editor-toolbar { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid #e4e7ec; background: #f9fafb; border-radius: 6px 6px 0 0; }
.editor-btn { padding: 4px 10px; border: 1px solid #d0d5dd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 13px; }
.editor-btn:hover { background: #f2f4f7; }
.editor-btn-ai { background: linear-gradient(135deg, #f0e6ff 0%, #e6f0ff 100%); }
.editor-blocks { display: flex; flex-direction: column; gap: 8px; padding: 12px; min-height: 120px; }
.editor-block { display: flex; gap: 6px; align-items: flex-start; padding: 6px; border: 1px solid transparent; border-radius: 4px; }
.editor-block:focus-within { border-color: #d0d5dd; background: #f9fafb; }
.editor-block-body { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.editor-block textarea, .editor-block input[type="text"], .editor-block select { width: 100%; font: inherit; padding: 6px 8px; border: 1px solid #d0d5dd; border-radius: 4px; box-sizing: border-box; }
.editor-block-heading textarea { font-weight: 600; font-size: 18px; }
.editor-block-pullquote textarea { font-style: italic; }
.editor-block-callout .editor-block-body { background: #f0f9fc; border-radius: 6px; padding: 8px; }
.editor-block-affiliate .editor-block-body { background: #fffaf0; border-radius: 6px; padding: 8px; }
.editor-block-label { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #667085; }
.editor-block-controls { display: flex; flex-direction: column; gap: 4px; }
.editor-block-ctrl { width: 28px; height: 28px; border: 1px solid #d0d5dd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 13px; line-height: 1; }
.editor-block-ctrl:hover { background: #f2f4f7; }
.editor-block-ctrl-remove:hover { background: #fef3f2; border-color: #fda29b; color: #b42318; }
.editor-add-block { position: relative; padding: 8px 12px 12px; }
.editor-add-block-btn { width: 100%; padding: 6px; border: 1px dashed #d0d5dd; background: #fff; border-radius: 4px; cursor: pointer; color: #475467; }
.editor-add-block-btn:hover { background: #f9fafb; }
.editor-block-menu { position: absolute; bottom: 44px; left: 12px; right: 12px; max-height: 280px; overflow-y: auto; background: #fff; border: 1px solid #d0d5dd; border-radius: 6px; box-shadow: 0 8px 24px rgba(20,30,50,0.12); z-index: 30; }
.editor-block-menu-item { display: flex; gap: 8px; align-items: center; width: 100%; padding: 8px 12px; border: 0; background: #fff; cursor: pointer; text-align: left; font-size: 13px; }
.editor-block-menu-item:hover { background: #f2f4f7; }
.editor-block-menu-icon { display: inline-block; width: 24px; text-align: center; color: #475467; }
.editor-block-menu-sep { height: 1px; background: #e4e7ec; margin: 4px 0; }
.editor-image-drop { border: 2px dashed #d0d5dd; border-radius: 6px; padding: 20px; text-align: center; color: #667085; cursor: pointer; background: #f9fafb; }
.editor-image-drop.dragover { border-color: #1ba8c8; background: #f0f9fc; }
.editor-image-preview img { max-width: 100%; height: auto; border-radius: 4px; display: block; }
.editor-image-actions { display: flex; gap: 6px; }
.editor-ai-overlay { position: fixed; inset: 0; background: rgba(16,24,40,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.editor-ai-modal { background: #fff; border-radius: 8px; padding: 16px; width: min(480px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 10px; }
.editor-ai-modal h3 { margin: 0; font-size: 16px; }
.editor-ai-modal textarea { width: 100%; font: inherit; padding: 6px 8px; border: 1px solid #d0d5dd; border-radius: 4px; box-sizing: border-box; }
.editor-ai-status { font-size: 13px; color: #667085; min-height: 18px; }
.editor-ai-status.error { color: #b42318; }
.editor-ai-actions { display: flex; gap: 8px; justify-content: flex-end; }
.editor-ai-actions button { padding: 6px 12px; border: 1px solid #d0d5dd; border-radius: 4px; background: #fff; cursor: pointer; }
.editor-ai-actions .editor-ai-generate { background: #1ba8c8; border-color: #1ba8c8; color: #fff; }
.editor-ai-actions button[disabled] { opacity: 0.5; cursor: default; }
.editor-ai-result img { max-width: 100%; border-radius: 4px; display: block; }
`;
