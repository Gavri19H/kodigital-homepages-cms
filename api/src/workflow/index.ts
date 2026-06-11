// Public surface for the publish workflow module. Admin endpoints (T10,
// T26) import `publish`, the non-publish transitions, the version-history
// operations and the state-machine helpers from here so callers do not
// depend on internal file layout.

export {
  VALID_TRANSITIONS,
  isValidTransition,
  publish,
  snapshotVersion,
} from "./publish";
export type {
  ArticleStatus,
  PublishOptions,
  StatusTransition,
} from "./publish";
export {
  archive,
  cancelSchedule,
  schedule,
  unpublish,
} from "./transitions";
export {
  getVersion,
  listVersions,
  restoreVersion,
} from "./versions";
export type {
  ArticleVersionListEntry,
  ArticleVersionRow,
  RestoreResult,
} from "./versions";
export {
  createPreviewLink,
  PREVIEW_TOKEN_TTL_SECONDS,
} from "./preview-link";
export type { PreviewLink } from "./preview-link";
