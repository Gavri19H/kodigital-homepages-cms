// Public surface for the editor module: block-level rendering and the
// HTML sanitizer. T6 (publish workflow) imports `contentJsonToHtml` to
// snapshot the rendered HTML on publish; future admin endpoints will
// import `sanitizeHtml` directly to scrub user-provided settings HTML.

export {
  ALLOWED_BLOCK_TYPES,
  contentJsonToHtml,
  isAllowedBlockType,
  renderBlock,
} from "./blocks";
export type { BaseBlock, BlockType, ContentDocument } from "./blocks";

export { escapeHtml, sanitizeHtml } from "./sanitize";
