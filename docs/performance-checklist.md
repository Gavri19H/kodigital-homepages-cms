# Performance Checklist

`kodigital-homepages-cms` is a Cloudflare-Workers + D1 + KV + R2 stack
serving public marketing/article HTML to anonymous users. The public
budget is "TTFB under 200ms at the edge, LCP under 2.5s on 4G mobile,
CLS = 0, public JavaScript payload near zero." Every item below is a
hard checkbox the public templates + router already enforce; the
checklist exists so a future contributor can verify "did my change
regress the page-weight or layout-stability budget" without having to
re-derive the rules from the renderer source.

The owning modules are:

- `api/src/public/templates/layout.ts` (T23) — `<img>` / hero / ad slot
  emitters with explicit dimensions + load hints.
- `api/src/public/templates/public.css.ts` (T23) — inline-cached CSS
  with reserved ad-slot dimensions + `prefers-reduced-motion` rules.
- `api/src/public/templates/seo-head.ts` (T8) — `<link rel="canonical">`
  + OG + Twitter + robots head builder (no per-request JS).
- `api/src/cache/cache-control.ts` (T3) — every `Cache-Control` policy
  the router applies (public HTML is `public, max-age=300,
  stale-while-revalidate=86400`; admin is `private, no-store`).
- `api/src/cache/edge-cache.ts` (T2) — Cache API + KV bridge that
  serves cached HTML with `ETag` + 304 short-circuit.

## Image dimensions + load hints

Every `<img>` rendered by `layout.ts` MUST have explicit `width=`,
`height=`, and `decoding="async"`. The two helpers split by viewport
role:

| Helper | Use case | Load hint |
|---|---|---|
| `renderHeroImage` | Above-the-fold (first paint) | `loading="eager"` + `fetchpriority="high"` |
| `renderBodyImage` | Below-the-fold (article body, related cards) | `loading="lazy"` |

The two helpers exist so the renderer cannot accidentally emit a hero
without `fetchpriority="high"` (LCP regression) or a body image
without `loading="lazy"` (extra bytes before LCP). Reviewers should
flag any handwritten `<img>` literal in a template — the helpers are
the only sanctioned surface.

Explicit `width=` + `height=` are non-negotiable: without them the
browser cannot reserve the image's box before the bitmap arrives, and
CLS spikes. The helpers refuse to render without both dimensions
(TypeScript signature requires them).

## Reserved ad slot dimensions

`public.css.ts` reserves dimensions for every ad slot the layout can
render so the page does NOT shift when the iframe loads. The
`.ad-slot` class declares `min-width` + `min-height` per slot variant:

| Variant | Reserved dims | Use case |
|---|---|---|
| `.ad-slot-rectangle` | 300×250 | In-body medium rectangle |
| `.ad-slot-leaderboard` | 728×90 | Above-article leaderboard |
| `.ad-slot-skyscraper` | 160×600 | Sidebar skyscraper |

The dimensions are duplicated inline (`style="min-width:Xpx;
min-height:Ypx"`) on the slot `<div>` AS WELL AS in the cached CSS so
the reserved box paints on the first frame even if the stylesheet
arrives a tick later. This is intentional belt-and-suspenders — the
inline style alone cannot be cached across pages, and the cached CSS
alone cannot reserve the box on a stylesheet miss. Both surfaces
together → CLS = 0 by construction.

The same rule applies to images: any `<img>` that does NOT use one of
the layout helpers MUST inline `width=` + `height=` on the element so
the reserved box paints before the bitmap decodes.

## No-layout-shift CSS

`public.css.ts` is rendered inline in `<head>` (no extra round-trip)
and follows three rules:

1. Every block that may host async content reserves dimensions
   (ad slots, hero image wrapper, media-block placeholders).
2. No `@import` or webfont URLs — fonts are system-stack only, so
   FOIT/FOUT cannot cause CLS.
3. The stylesheet is cacheable along with the surrounding HTML
   response (it ships in the response body, NOT as a separate
   request), so the public `Cache-Control: public, max-age=300,
   stale-while-revalidate=86400` policy from `cache-control.ts`
   applies to the stylesheet bytes too. There is no separate
   `style.css` URL to cache-bust.

The "cacheable CSS" rule means: do not split the stylesheet into a
separate file unless the file has a versioned URL keyed by
`TEMPLATE_VERSION`. The inline form is strictly cheaper at our scale
because every public HTML response is already KV-cached + edge-cached
with `Cache-Control: public, max-age=300`.

## Public JS budget

The public templates ship ZERO bytes of JavaScript by default. The
only sanctioned exceptions:

- Cloudflare Web Analytics beacon (single async script tag, no inline
  init code, served from Cloudflare's CDN).
- Ad-network loader script in the rendered ad slot (third-party, but
  isolated to the reserved `.ad-slot` box so a slow ad cannot block
  the rest of the page).

Anything else — analytics tags, hydration shims, "interactive" widgets
— is OUT OF BUDGET for Phase 7. The renderer is server-rendered HTML;
there is no client-side framework. If a future story needs a small
interactive element, prefer a `<details>` / `<dialog>` / native form
over JS, and document the budget exception here before adding the
tag.

## Cacheable response policy

Every public response uses the helpers from `cache-control.ts` so the
edge can revalidate cheaply:

| Route class | Helper | `Cache-Control` value |
|---|---|---|
| Public HTML (article/home/category/page) | `publicHtmlCacheHeaders` | `public, max-age=300, stale-while-revalidate=86400` |
| Sitemap / RSS / Atom feed | `feedCacheHeaders` | `public, max-age=300, stale-while-revalidate=86400` |
| `robots.txt` / `ads.txt` | `robotsAdsCacheHeaders` | `public, max-age=3600, stale-while-revalidate=86400` |
| Admin routes | `adminCacheHeaders` | `private, no-store` |
| 404 (any route) | `publicHtmlCacheHeaders` (short) | `public, max-age=60` |
| Off-admin-host `/admin` probe | `offAdminHostHeaders` | `private, no-store` + `X-Robots-Tag: noindex` |

The 300s public TTL is intentional: it lets the edge serve a stale
response while a fresh render runs in the background
(`stale-while-revalidate=86400`), which means publish-driven
invalidation is felt within a few seconds but a backend hiccup never
causes a public outage. See `docs/cache-strategy.md` for the
content_version + settings_version bump rules that drive the
invalidation events.

## Pre-commit performance checks

Before committing a public-template change, walk this list:

1. Does every new `<img>` use `renderHeroImage` or `renderBodyImage`?
   (If not, why is a raw `<img>` necessary, and does it have inline
   `width=` + `height=` + `decoding="async"`?)
2. Does the hero image have `loading="eager"` + `fetchpriority="high"`
   AND every below-fold image have `loading="lazy"`?
3. Does every new ad slot use one of the `.ad-slot-*` variant classes
   with reserved dimensions, AND inline a matching `style=
   "min-width:Xpx;min-height:Ypx"` for the first-paint box?
4. Did the change add any inline `<script>` or external `<script
   src=…>` to the public layout? If yes, document the budget
   exception here before merging.
5. Did the response handler call the appropriate
   `cache-control.ts` helper (NOT a hand-rolled `Cache-Control`
   string)?
6. Is the stylesheet still inline-cacheable? (No new external CSS
   URLs, no `@import` rules, no webfont links.)

A "yes" to all six = no performance regression. A "no" anywhere is a
budget exception that needs an entry in this checklist before the
story is mergeable.

## Cross-references

- `docs/cache-strategy.md` (T29) — KV/Cache-API/ETag policy and the
  `content_version` / `settings_version` invalidation rules that this
  checklist's `Cache-Control` values depend on.
- `docs/seo-strategy.md` (T27) — canonical-host policy + per-route
  schema map (the head emitter that this checklist relies on for "no
  per-request JS in head").
- `docs/cache-purge-safety.md` (T31) — the protected-domain refusal
  rules a publish/invalidate cycle must obey before purging.
- `docs/storage-cost-model.md` (T32) — the cost model that depends on
  the cache-hit ratios this checklist's policies sustain (a CLS-free
  public template is also a cheaper template because we never
  re-render to fix layout bugs in the field).
