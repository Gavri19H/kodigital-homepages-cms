// T2: every public image URL is served through the /media/<storage_key>
// route. D1 stores only the bare R2 storage key (media.storage_key); the
// public Worker serves the blob at GET /media/* (see media/serve.ts) and the
// admin side already prefixes uploads with "/media/" + storageKey (see
// admin/media-crud-handlers.ts). The public view models historically returned
// the bare storage key, so <img src="..."> pointed at a non-route and every
// public image rendered broken. mediaUrl() is the single place that turns a
// stored media reference into the correct public web address.
//
// The public templates render imageUrl / ogImage / body-image src verbatim
// (no prefixing of their own — see templates/components.ts + templates/
// article.ts), so the view model is the one place the prefix belongs.

const MEDIA_PREFIX = "/media/";

/**
 * "The operator has not picked an image yet" — a real, code-owned value rather
 * than a fake storage key (owner ruling 2026-08-11).
 *
 * WHY IT EXISTS. content-schema REQUIRES a non-empty imageMediaId on an image
 * card ("Every answer on the Image answer cards needs an image") and a non-empty
 * logoMediaId on a HeaderLogo, so a scaffolded card/logo cannot simply carry
 * nothing — a seedless scaffold is unsaveable the moment it is added. The studio
 * therefore used to invent keys: "media_option_3", "media_" + value,
 * "media_logo". Nothing ever stored those, so a freshly added card or logo
 * rendered a BROKEN IMAGE until the operator happened to pick a real one.
 *
 * This value keeps the save legal AND is recognisable, so a renderer can paint an
 * honest labelled placeholder ("Image" / "Site logo") in the slot instead. It can
 * never collide with a real reference: R2 storage keys are date-pathed
 * ("2026/08/02/<uuid>.png"), and rooted/absolute/data URLs all start with "/",
 * "http" or "data:".
 *
 * mediaUrl() deliberately still ADDRESSES it (→ "/media/__pending__") rather than
 * returning null: every call site here does `esc(mediaUrl(x))`, and esc(null) is
 * "", which would emit `src=""` — a broken image by another name. Callers guard
 * with isPendingMediaRef BEFORE they reach for a URL.
 */
export const MEDIA_PENDING_REF = "__pending__";

/** Whether a stored media reference means "not chosen yet" (never an address). */
export function isPendingMediaRef(ref: string | null | undefined): boolean {
  return typeof ref === "string" && ref.trim() === MEDIA_PENDING_REF;
}

/**
 * Resolve a stored media reference to its public /media/ web address.
 *
 *  - null / undefined / empty            -> null  (no "/media/null", no broken <img>)
 *  - already rooted ("/...") or absolute -> returned unchanged. Body-image src
 *    persisted by the block editor is already "/media/<key>" (see
 *    editor/editor-scripts.ts), and an external "http(s)://" / "data:"
 *    image URL must never be rewritten into a broken /media/ path.
 *  - a bare storage key                  -> "/media/<storage_key>"
 */
export function mediaUrl(ref: string | null | undefined): string | null {
  if (ref === null || ref === undefined) return null;
  const key = ref.trim();
  if (key.length === 0) return null;
  if (
    key.startsWith("/") ||
    key.startsWith("http://") ||
    key.startsWith("https://") ||
    key.startsWith("data:")
  ) {
    return key;
  }
  return MEDIA_PREFIX + key;
}
