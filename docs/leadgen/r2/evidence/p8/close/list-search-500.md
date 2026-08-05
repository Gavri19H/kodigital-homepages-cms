# CLOSE finding — four admin list routes 500 on operator search ≥49 chars (same LIKE class)

Found by W1's mandated class-sweep of every LIKE/GLOB in `src/admin/leadgen/**` +
`src/public/leadgen/**` after the theme-PATCH fix. NOT fixed — the files are outside every
P8 §4–§7 item and outside the W1 slice's ownership; surfaced for the owner's fix-or-defer
ruling per the mission loop.

**Sites:** `offers-handlers.ts:666`, `offers-handlers.ts:793` (`searchOffersHandler`, `?q=`),
`auctions-handlers.ts:422`, `sections-handlers.ts:733`, `quotes-handlers.ts:1392` — each wraps
raw operator search input as `%…%` with no length clamp
(`c.req.query("search")?.trim()`), and D1 caps LIKE patterns at 50 bytes.

**Live proof (HEAD, wrangler dev :8951):** a 47-char search term → HTTP 200; a 49-char term →
HTTP 500 on ALL FOUR list routes (`GET /offers`, `/auctions`, `/sections`, `/quotes` — each
measured 200/500). Any operator typing or pasting a ≥49-char search into the library search
boxes 500s the list page.

**Shape of the fix if taken:** one shared clamp adjacent to the existing `escapeLike` helper
(`offers-handlers.ts:168` names the convention) applied at the five sites; pattern bound
≤50 bytes by construction, same approach the theme-PATCH fix used. Small, mechanical,
pre-existing (the sites predate P8).
