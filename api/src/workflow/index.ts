// Public surface for the publish workflow module. Admin endpoints (T10)
// import `publish` and the state-machine helpers from here so callers do
// not depend on internal file layout.

export {
  VALID_TRANSITIONS,
  isValidTransition,
  publish,
} from "./publish";
export type {
  ArticleStatus,
  PublishOptions,
  StatusTransition,
} from "./publish";
