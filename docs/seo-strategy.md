# SEO Strategy

`kodigital-homepages-cms` ships SEO surface as a first-class part of the
public renderer, not as an after-the-fact concern. This document records
the head-template structure, the JSON-LD policy, the canonical host
policy, and the per-route schema map so that contributors can extend the
public surface without re-deriving the rules.

The wire shape is owned by `api/src/public/templates/seo-head.ts`
(`renderSeoHead` + `buildCanonicalUrl`), `api/src/public/templates/jsonld-article.ts`
(`renderArticleJsonLd` / `renderBreadcrumbJsonLd` / `renderFaqJsonLd`),
and `api/src/public/templates/jsonld-home-category-page.ts`
(`renderHomeWebsiteJsonLd` / `renderHomeOrganizationJsonLd` /
`renderHomeItemListJsonLd` / `renderCategoryJsonLd` /
`renderWebPageJsonLd`). The code is authoritative; this doc is a
human-readable index of the contract those modules already encode.

## Head template structure

`renderSeoHead` (T8 — `api/src/public/templates/seo-head.ts`) is the
single emission point for the `<head>` block. Every public route
composes its `<head>` by calling this helper rather than building meta
tags ad hoc, so that the wire shape stays consistent across the home,
article, category, page, and feed surfaces.

The block always emits, in stable order:

1. `<title>` — caller-supplied page title; required input.
2. `<meta name="description">` — optional but recommended; falls back to
   omission rather than a tenant-default placeholder.
3. `<link rel="canonical">` — built via `buildCanonicalUrl` from the
   tenant's `canonical_host` + the request `path`, unless an explicit
   `canonicalUrl` override is supplied. Paginated category pages
   canonical to page 1; cross-tenant canonicals supply the override
   directly.
4. Open Graph block (`og:title`, `og:description`, `og:image`,
   `og:type`, `og:url`, optional `og:locale`, optional `og:site_name`).
   Defaults: `og:type=website`, `og:url=canonical`. Article routes pass
   `og:type=article`.
5. Twitter Card block (`twitter:card`, `twitter:title`,
   `twitter:description`, optional `twitter:site`). Default
   `twitter:card=summary_large_image`.
6. `<meta name="robots">` — defaults to `index, follow`. Staging hosts,
   draft articles, and unmapped-host responses pass
   `noindex, nofollow` explicitly.

All string inputs are HTML-escaped inside `renderSeoHead` via the
module-local `escapeHtml`; callers MUST NOT pre-escape. The renderer
emits empty strings rather than empty tags when an optional field is
absent.

## JSON-LD policy

JSON-LD is emitted as one or more `<script type="application/ld+json">`
tags per page, each containing a single root object (no JSON arrays at
the top level — multiple `@type`s ship as multiple script tags). Every
emitter in `jsonld-article.ts` and `jsonld-home-category-page.ts`
follows the same conventions:

- `@context` is always `https://schema.org`.
- String values pass through a module-local `jsonString` that produces
  RFC-8259 JSON strings; binary or HTML payloads are never inlined.
- Each emitter calls `safeForScriptTag` before returning, which escapes
  `</` to `<\/` so a closing-script-tag substring in user content
  cannot break out of the JSON-LD block.
- Optional fields are omitted from the JSON object rather than emitted
  with `null` or empty string — Google and Bing both treat missing as
  unknown but flag empty as malformed.
- The renderer is pure: no I/O, no fetches, no DB reads. Caller code
  selects which emitter(s) to call based on route and content.

### SearchAction gate (Phase 7 red line)

The home `WebSite` JSON-LD (`renderHomeWebsiteJsonLd`) supports a
`potentialAction` with `@type=SearchAction`, but **Phase 7 does not
ship a `/search` route**, so the `SearchAction` is gated behind two
inputs that must BOTH be set:

- `searchRouteEnabled === true` (boolean flag), AND
- `searchUrlTemplate` is a non-empty string template that includes
  `{search_term_string}`.

If either input is missing, `potentialAction` is omitted entirely.
This avoids emitting a structured-data hint for a route that returns
404. The cross-emitter assertion in
`api/test/json-ld-home.test.ts` enforces that no other home emitter
(Organization, ItemList, CollectionPage, WebPage) ever contains the
substring `"SearchAction"`. Adding `/search` in a later phase MUST
flip the gate flag AND register the route AND supply the URL
template — all three are required to keep the structured-data hint
honest.

### Per-route JSON-LD selection

Each public route emits a curated set of JSON-LD blocks; do not add
new `@type`s without a per-route review. The current map is in the
"Per-route schema map" section below.

## Canonical host policy

Every tenant ("site row") owns a single `canonical_host` string. The
public renderer treats this as the source of truth for canonical URLs;
the request host is not used directly because the same Worker may
serve preview-host, staging-host, or in-flight DNS-cutover requests
that MUST NOT bleed into canonical URLs.

`buildCanonicalUrl(canonicalHost, path)` in
`api/src/public/templates/seo-head.ts` enforces the normalization
contract:

- Host: trimmed, lowercased, leading `http://` / `https://` stripped,
  trailing slashes stripped. Empty host throws — the renderer never
  substitutes a default host or falls back to `cms.kodigital.app`
  (the admin host is on the design-contract forbidden-substitutes
  list and a canonical leak to it would defeat SEO).
- Path: `null` / `undefined` / `""` collapses to `/`. Leading `/` is
  enforced. A trailing `/` is stripped for any path longer than 1
  character (so `/article/foo/` canonicalizes to `/article/foo` and
  `/` stays `/`). Query strings and fragments pass through verbatim
  — callers are responsible for excluding session params from the
  canonical they pass in.
- Scheme: always `https://`. The renderer never emits `http://`
  canonicals; HTTP requests are 301-redirected at the edge before
  reaching the renderer.

Routes that paginate (currently `/category/:slug/page/:page`)
canonical to page 1 — they pass `canonicalUrl` explicitly rather than
relying on the request path. Routes that serve content from an
explicit cross-tenant source (e.g. a syndicated article) MUST pass
`canonicalUrl` pointing at the upstream source; never let the
renderer build a canonical against the local host for syndicated
content.

The admin host (`cms.kodigital.app`) is NEVER a canonical target for
public content. The
`design_contract.forbidden_substitutes.canonical_url` red line in the
typed contract guards this — any code path that would emit a
canonical pointing at the admin host is a contract violation.

## Per-route schema map

The public router is `api/src/public/router.ts`. The table below
records, per route, which JSON-LD `@type`s are emitted today.
Additions or removals MUST update both the renderer and this map in
the same change.

| Route | `<head>` via | JSON-LD `@type`s emitted |
|---|---|---|
| `GET /` (home) | `renderSeoHead` | `WebSite` (SearchAction GATED, see policy above), `Organization`, `ItemList` (article list) |
| `GET /article/:slug` | `renderSeoHead` (`og:type=article`) | `Article`, `BreadcrumbList`, `FAQPage` (only when article has FAQ payload) |
| `GET /category/:slug` (page 1) | `renderSeoHead` | `CollectionPage`, `ItemList`, `BreadcrumbList` |
| `GET /category/:slug/page/:page` (page >= 2) | `renderSeoHead` (canonical → page 1) | `CollectionPage`, `ItemList`, `BreadcrumbList` |
| `GET /page/:slug` (CMS page) | `renderSeoHead` | `WebPage`, `BreadcrumbList` |
| `GET /:slug` (legacy / pretty top-level page) | `renderSeoHead` | `WebPage` |
| `GET /preview/:id` | `renderSeoHead` (`robots=noindex, nofollow`) | none — preview must not seed structured data |
| `GET /sitemap.xml` | n/a (XML) | n/a — listed here so contributors don't add JSON-LD to a non-HTML route |
| `GET /feed.xml`, `GET /atom.xml` | n/a (XML) | n/a — RSS/Atom is the structured data |
| `GET /robots.txt` | n/a (text) | n/a |
| `GET /ads.txt` | n/a (text) | n/a |
| `GET /health` | n/a (JSON) | n/a |

### What we deliberately do NOT emit

- `SearchAction` on `WebSite` when the search route is not registered
  (see policy above).
- `Product` / `Offer` / `Review` — these belong to an e-commerce
  surface that is out of scope for the CMS.
- `BreadcrumbList` on the home `/` route — home is the root and a
  single-item breadcrumb adds noise without lift.
- JSON-LD on preview, sitemap, feed, robots, ads, or health routes.

## Adding a new public route

1. Decide whether the route is HTML or machine-readable. JSON-LD only
   applies to HTML; XML/text routes are excluded by design.
2. Write a route handler that builds a typed view-model and calls
   `renderSeoHead` for the `<head>` block. Canonical via
   `buildCanonicalUrl(canonical_host, path)` unless paginated /
   cross-tenant.
3. Pick the smallest set of JSON-LD `@type`s that accurately describe
   the page content. If no existing emitter fits, add a new one to
   `jsonld-article.ts` or `jsonld-home-category-page.ts` (follow the
   `jsonString` + `safeForScriptTag` pattern).
4. Add the route to the per-route schema map in this document and to
   the cross-emitter coverage tests in
   `api/test/json-ld-home.test.ts` so the SearchAction-omitted red
   line still holds.
5. If the route should be cached, follow `docs/cache-strategy.md` for
   the key-version policy.
