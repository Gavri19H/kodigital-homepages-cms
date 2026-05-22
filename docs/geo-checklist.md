# GEO Checklist

GEO ("Generative Engine Optimization") is the discipline of making content
legible to retrieval-augmented engines (Google AI Overviews, Perplexity,
ChatGPT browsing, Bing Copilot) in addition to classic SEO crawlers. The
`kodigital-homepages-cms` public renderer treats GEO surface as a
first-class wire contract, owned by the same `renderSeoHead` +
JSON-LD emitters that drive SEO (see `docs/seo-strategy.md`). This
document is the per-page checklist a contributor walks when adding,
editing, or auditing a public route.

GEO and SEO share the same head + JSON-LD pipeline; this checklist is
the operational complement to `docs/seo-strategy.md` (head structure +
per-route schema map) and `docs/cache-strategy.md` (key format +
version-bump strategy — landed by T29).

## What generative engines need that classic SEO does not

Generative engines lift facts directly from page markup, not just from
indexed text, so the bar is higher on three axes:

1. **Structured facts over prose facts.** A fact buried only in body
   text may be paraphrased correctly by an engine — or not. The same
   fact emitted as JSON-LD (`Article.author`, `Article.datePublished`,
   `FAQPage.mainEntity[].acceptedAnswer.text`) is machine-extractable
   and cite-stable.
2. **Recency signals tied to the asset, not the request.** A timestamp
   in the response footer ("loaded at 2026-05-22") tells the engine
   nothing about content age. `dateModified` on the JSON-LD `Article`
   does.
3. **Canonical identity that survives re-publication.** When a generated
   answer cites a URL, the URL must keep pointing at the same content.
   That requires consistent canonicals across paginated, syndicated,
   and host-aliased variants.

The five sections below are the audit checklist contributors run before
shipping a new route.

## 1. FAQ schema (Question / Answer pairs)

Every article that ends with an FAQ block (or has an inline
"Frequently asked questions" section) MUST emit a `FAQPage` JSON-LD
block via `renderFaqJsonLd` (T9 — `api/src/public/templates/jsonld-article.ts`).
The emitter's contract:

- `@type: FAQPage` at the document root.
- `mainEntity` is an array of `Question` objects.
- Each `Question` has a `name` (the question text) and an
  `acceptedAnswer` of `@type: Answer` with `text` set to the
  plain-text answer body.
- Empty FAQ sets MUST result in the helper being skipped, NOT in an
  emitted `FAQPage` with `mainEntity: []` (engines treat the empty
  block as a negative signal).

Routes that emit FAQ schema today: article. Routes that do NOT:
homepage, category, page, sitemap, feed, robots, ads — emitting
FAQPage on a non-FAQ surface is forbidden.

## 2. Breadcrumbs (BreadcrumbList)

Every content route (article + category + page) MUST emit a
`BreadcrumbList` JSON-LD block via `renderBreadcrumbJsonLd`
(T9 — `api/src/public/templates/jsonld-article.ts`). The emitter's
contract:

- `@type: BreadcrumbList` at the document root.
- `itemListElement` is an array of `ListItem` objects, ordered
  root-first (Home -> Category -> Article).
- Each `ListItem` has a `position` (1-indexed), `name`, and `item`
  (absolute URL built via `buildCanonicalUrl`).
- Homepage routes MUST NOT emit a `BreadcrumbList` (a one-item
  breadcrumb chain is a negative signal — engines read it as an
  authoring mistake).

Breadcrumbs are the primary signal that lets a generative engine
reason about a page's position in the site taxonomy. Missing
breadcrumbs on a deep article = engines treat the article as a
top-level document, which hurts grouping in AI summaries.

## 3. Author metadata (Article.author + Organization.publisher)

Every article MUST emit a `Person` (or `Organization`) `author`
inside its `Article` JSON-LD via `renderArticleJsonLd` (T9). The
emitter's contract:

- `author.@type` is `Person` for human bylines, `Organization` for
  tenant-authored content (newsdesk / staff posts).
- `author.name` is required; `author.url` is recommended (links to the
  author's profile page or site bio).
- `publisher` (set inside the same JSON-LD block) is the tenant
  `Organization` and supplies `name` + `logo` (an `ImageObject` with
  `url`).
- Anonymous content MUST set `author` to the publisher
  `Organization`, not omit the field — engines treat a missing
  `author` as low-trust signal.

Author metadata is the primary E-E-A-T (Expertise / Experience /
Authoritativeness / Trustworthiness) anchor in generative responses.
A cite that names a human author is materially more likely to be
selected than an anonymous cite.

## 4. Freshness dates (datePublished + dateModified)

Every article MUST emit both `datePublished` and `dateModified` in
its `Article` JSON-LD. The emitter's contract:

- Both fields are ISO-8601 strings, sourced from
  `articles.published_at` and `articles.updated_at` respectively.
- `dateModified >= datePublished` at all times. A `dateModified`
  earlier than `datePublished` is a publishing-pipeline bug; the
  workflow (T14 — `api/src/workflow/publish.ts`) is responsible for
  ordering.
- The two fields are emitted on their OWN source lines in the
  emitter (T9-AC2 grep field-discipline contract). Editors MUST NOT
  collapse them into a single string-template literal.
- The freshness signal is reinforced by the homepage `ItemList`
  (T10), which lists articles in `published_at DESC` order — engines
  cross-check the homepage rank against `datePublished` to validate
  the freshness story.

`dateModified` is NOT a re-publication timestamp. Cosmetic edits
(typo fixes, header changes) MUST NOT bump it; substantive content
changes (new sections, factual corrections, updated quotes) MUST.

## 5. Canonical URL consistency

Every public route MUST emit `<link rel="canonical">` via
`renderSeoHead` + `buildCanonicalUrl` (T8 —
`api/src/public/templates/seo-head.ts`) AND repeat the same URL in
JSON-LD `mainEntityOfPage` / `Article.url`. The emitter's contract:

- The canonical URL is built from
  `https://${tenant.canonical_host}${path}` unless an explicit
  `canonicalUrl` override is supplied.
- Paginated category pages (`/category/:slug/page/:n` for `n>1`)
  canonical to page 1.
- Cross-tenant syndicated content supplies the override directly so
  the canonical points at the original publisher.
- The `cms.kodigital.app` admin host is NEVER a content-page
  canonical — `seo-head.ts` does not hardcode it; the helper takes
  the `canonicalHost` argument from the resolved tenant
  (see T8-AC3 + the AC "MUST NOT hardcode cms.kodigital.app as a
  content-page canonical").
- The canonical URL emitted in the `<head>` MUST byte-equal the
  `url` field in JSON-LD blocks for the same page. A drift between
  the two is the single most common cause of generative engines
  attributing a cite to the wrong canonical.

## Per-page checklist (audit form)

When adding or auditing a public route, walk this checklist:

| Field                       | Article | Category | Page | Home |
|-----------------------------|:-------:|:--------:|:----:|:----:|
| `<title>`                   |   yes   |   yes    | yes  | yes  |
| `<meta description>`        |   yes   |   yes    | yes  | yes  |
| `<link rel="canonical">`    |   yes   |   yes    | yes  | yes  |
| `og:*` + `twitter:*`        |   yes   |   yes    | yes  | yes  |
| `Article` JSON-LD           |   yes   |    no    |  no  |  no  |
| `BreadcrumbList` JSON-LD    |   yes   |   yes    | yes  |  no  |
| `FAQPage` JSON-LD           | yes(*)  |    no    |  no  |  no  |
| `WebSite` JSON-LD           |   no    |    no    |  no  | yes  |
| `Organization` JSON-LD      |   no    |    no    |  no  | yes  |
| `ItemList` JSON-LD          |   no    |  yes(*)  |  no  | yes  |
| `CollectionPage` JSON-LD    |   no    |   yes    |  no  |  no  |
| `WebPage` JSON-LD           |   no    |    no    | yes  |  no  |
| `datePublished` (JSON-LD)   |   yes   |    no    |  no  |  no  |
| `dateModified` (JSON-LD)    |   yes   |    no    |  no  |  no  |
| `author` (JSON-LD)          |   yes   |    no    |  no  |  no  |
| `Cache-Control` (public)    |   yes   |   yes    | yes  | yes  |

`(*)` = emit only when the underlying data block is non-empty (FAQ
items, category article list).

## Deliberate exclusions (do NOT add)

- **SearchAction (potentialAction) when there is no `/search` route.**
  Emitting `SearchAction` is a negative signal — engines try to use it
  and the resulting 404 is held against the tenant. `renderHomeWebsiteJsonLd`
  (T10) gates emission behind `searchRouteEnabled`. The router does NOT
  register a `/search` route in Phase 7 (T26-AC2).
- **Product / Offer / Review schemas.** Out of scope for Phase 7 — the
  CMS does not model commerce inventory.
- **Speakable schema.** Out of scope; we would need an additional
  editorial discipline (highlighted speakable sentences) we do not yet
  have.

## Adding a new public route — runbook

1. Decide which JSON-LD types the route MUST emit (consult the table
   above).
2. Add the route handler in `api/src/public/router.ts` (T11/T12/T13).
3. Compose the `<head>` via `renderSeoHead` — pass the tenant's
   resolved `canonicalHost`.
4. Compose the JSON-LD via the matching emitter(s) — keep the
   field-discipline rule (each schema field on its own source line).
5. Walk this checklist + the schema map in `docs/seo-strategy.md` +
   the cache-key format in `docs/cache-strategy.md` (T29) before
   merging.
