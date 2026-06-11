// Public surface for the editor module: block-level rendering, HTML
// sanitizer, and the client-side editor bootstrap script.
//
// T6 (publish workflow) imports `contentJsonToHtml` to snapshot the
// rendered HTML on publish. Admin form templates (articleFormPage,
// pageFormPage) import `editorScripts` / `createEditor` to mount the
// client-side block editor on `textarea[name="content_json"]`.

export {
  ALLOWED_BLOCK_TYPES,
  contentJsonToHtml,
  isAllowedBlockType,
  renderBlock,
} from "./blocks";
export type { BaseBlock, BlockType, ContentDocument } from "./blocks";

export { escapeHtml, isSafeUrl, sanitizeHtml } from "./sanitize";

import { editorScripts as _editorScripts } from "./editor-scripts";
export { editorScripts, editorStyles } from "./editor-scripts";

// Factory used by admin form templates: returns the IIFE script string
// that, when embedded in a `<script>` tag, mounts BlockEditor on every
// `textarea[name="content_json"]` in the document.
export function createEditor(): string {
  return _editorScripts();
}
