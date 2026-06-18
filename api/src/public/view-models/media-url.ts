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
 * Resolve a stored media reference to its public /media/ web address.
 *
 *  - null / undefined / empty            -> null  (no "/media/null", no broken <img>)
 *  - already rooted ("/...") or absolute -> returned unchanged. Body-image src
 *    persisted by the block editor is already "/media/<key>" (see
 *    editor/editor-script-media.ts), and an external "http(s)://" / "data:"
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
