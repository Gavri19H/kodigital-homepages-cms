# Proposal: cms-new-phase5-2026-05018

## Main Goal

Implement generic Home + Article public templates in the standalone CMS Worker so a tenant content domain renders the approved 13-section Home and 12-section Article using per-site brand tokens via SiteContext, with no TheIWise visible brand and no cms.kodigital.app leak.

- **Entity:** kodigital-homepages-cms public Worker (api/src/public/)
- **Action:** render Home + Article templates from per-site CMS data
- **Metric:** renderhome_function_exists >= 1
- **Failure criterion:** Any rendered output contains TheIWise/theiwise outside docs/reference allowlist; href="#" present in rendered home/article; section order differs from PART 1/PART 2; .article-shell omits minmax(0, 1fr); cms.kodigital.app appears in any public-domain body; any verify:* script non-zero.

## Stories (22)

### T1: Add public.css string module with all PART 3 tokens and PART 4 breakpoints [ui]

**Target files:** `src/public/assets/public-css.ts`

**Acceptance Criteria:**

- T1.AC1: grep -c -- '--tw-ink' api/src/public/assets/public-css.ts >= 1
- T1.AC2: grep -c '@media (max-width:1280px)' api/src/public/assets/public-css.ts >= 1
- T1.AC3: grep -c 'minmax(0, 1fr)' api/src/public/assets/public-css.ts >= 1

### T2: Add public.js string module with passive-listener reading progress + share/copy [ui]

**Target files:** `src/public/assets/public-js.ts`

**Acceptance Criteria:**

- T2.AC1: grep -c 'passive: true' api/src/public/assets/public-js.ts >= 1
- T2.AC2: grep -c 'navigator.share' api/src/public/assets/public-js.ts >= 1
- T2.AC3: grep -c 'reading-progress-bar' api/src/public/assets/public-js.ts >= 1

### T3: templates/layout.ts renders the <html> scaffold with site brand-token injection [ui]

**Target files:** `src/public/templates/layout.ts`

**Acceptance Criteria:**

- T3.AC1: grep -c 'skip-to-content' api/src/public/templates/layout.ts >= 1
- T3.AC2: grep -cE 'brand_tokens|brandTokens' api/src/public/templates/layout.ts >= 1
- T3.AC3: BEHAVIORAL: GIVEN HomeViewModel with site.brandTokens WHEN renderLayout THEN result contains the brand token inside a <style> block

### T4: templates/components.ts exports site-aware components [ui]

**Target files:** `src/public/templates/components.ts`

**Acceptance Criteria:**

- T4.AC1: grep -cE 'export function (renderHeader|renderHero|renderChipRail|renderCard|renderNewsletter|renderFooter|renderAdSlot|renderFloatingNext)' >= 8
- T4.AC2: grep -c 'data-ad-slot' >= 1
- T4.AC3: BEHAVIORAL: GIVEN CategoryChip slug=tech WHEN renderChipRail THEN result contains href=/category/tech AND no href=#

### T5: templates/icons.ts exports inline SVG icons [ui]

**Target files:** `src/public/templates/icons.ts`

**Acceptance Criteria:**

- T5.AC1: 5 icon exports
- T5.AC2: aria-hidden on decorative SVGs

### T6: templates/seo.ts exports JSON-LD builders + meta helpers [ui]

**Target files:** `src/public/templates/seo.ts`

**Acceptance Criteria:**

- T6.AC1: 5 seo exports
- T6.AC2: 6 JSON-LD types
- T6.AC3: BEHAVIORAL: GIVEN faqs=[] WHEN buildFaqJsonLd THEN empty string

### T7: templates/format.ts exports formatDate, formatReadTime, truncateExcerpt [ui]

**Target files:** `src/public/templates/format.ts`

**Acceptance Criteria:**

- T7.AC1: 3 format exports
- T7.AC2: BEHAVIORAL: truncateExcerpt with limit=12 yields <=13 char string ending in ellipsis

### T8: view-models/home.ts exports buildHomeViewModel(db, siteContext) [api]

**Target files:** `src/public/view-models/home.ts`

**Acceptance Criteria:**

- T8.AC1: buildHomeViewModel exported
- T8.AC2: site-scoped WHERE
- T8.AC3: >=3 .bind() calls
- T8.AC4: BEHAVIORAL: site A and B isolation — vm.featured contains only site A's articles

### T9: view-models/article.ts exports buildArticleViewModel + adaptBodyBlocks [api]

**Target files:** `src/public/view-models/article.ts`

**Acceptance Criteria:**

- T9.AC1: buildArticleViewModel exported
- T9.AC2: site_id scoped
- T9.AC3: adaptBodyBlocks present
- T9.AC4: BEHAVIORAL: content_json=null falls back to single html block from content_html
- T9.AC5: BEHAVIORAL: 2 faq blocks in content_json yield vm.faqs.length===2

### T10: templates/home.ts renders 13 sections in PART 1 order [ui]

**Target files:** `src/public/templates/home.ts`

**Acceptance Criteria:**

- T10.AC1: renderHome exported
- T10.AC2: BEHAVIORAL: section markers appear in PART 1 order
- T10.AC3: BEHAVIORAL: site.name appears in output AND theiwise does not

### T11: templates/article.ts renders 12 sections in PART 2 order + minmax(0, 1fr) [ui]

**Target files:** `src/public/templates/article.ts`

**Acceptance Criteria:**

- T11.AC1: renderArticle exported
- T11.AC2: BEHAVIORAL: 12 section markers appear in PART 2 order
- T11.AC3: BEHAVIORAL: article-shell minmax(0, 1fr) present
- T11.AC4: BEHAVIORAL: faqs=[] does NOT emit FAQPage JSON-LD

### T12: router.ts adds GET / handler wiring home view-model + template [api]

**Target files:** `src/public/router.ts`

**Acceptance Criteria:**

- T12.AC1: GET / registered
- T12.AC2: BEHAVIORAL: GET / on tenant returns 200 text/html with site-header + site-footer

### T13: /article/:slug uses Article template with fallback [api]

**Target files:** `src/public/router.ts`

**Acceptance Criteria:**

- T13.AC1: renderArticle + buildArticleViewModel wired
- T13.AC2: catch present
- T13.AC3: BEHAVIORAL: published article -> 200 with article-shell+hero+body
- T13.AC4: BEHAVIORAL: renderArticle throws -> 200 with content_html fallback

### T14: /assets/public.css + /assets/public.js cacheable routes [api]

**Target files:** `src/public/router.ts`

**Acceptance Criteria:**

- T14.AC1: both asset routes registered
- T14.AC2: immutable cache-control
- T14.AC3: BEHAVIORAL: GET /assets/public.css -> 200 text/css with --tw-brand
- T14.AC4: BEHAVIORAL: GET /assets/public.js -> 200 application/javascript with reading-progress-bar
- T14.AC5: BEHAVIORAL: explicit /assets/* routes win over /:slug catch-all

### T15: /category/:slug + /page/:slug use site-aware layout wrapper [api]

**Target files:** `src/public/router.ts`

**Acceptance Criteria:**

- T15.AC1: renderLayout used
- T15.AC2: BEHAVIORAL: GET /category/:slug -> 200 text/html with site-header + category name
- T15.AC3: BEHAVIORAL: GET /page/:slug -> 200 text/html with site-header + page content_html

### T16: Regression: cms.kodigital.app does not render home [infra]

**Target files:** `test/public-admin-host-no-home.test.ts`

**Acceptance Criteria:**

- T16.AC1: references cms.kodigital.app
- T16.AC2: BEHAVIORAL: Host=cms.kodigital.app GET / -> 404 no leak

### T17: Regression: reserved-path catch-all 404s admin/api/static/media/preview/health [infra]

**Target files:** `test/public-reserved-paths.test.ts`

**Acceptance Criteria:**

- T17.AC1: BEHAVIORAL: planted admin page GET /admin -> 404 no leak
- T17.AC2: covers all reserved paths

### T18: Regression: no hardcoded TheIWise brand in rendered Home + Article [infra]

**Target files:** `test/public-no-theiwise-brand-render.test.ts`

**Acceptance Criteria:**

- T18.AC1: BEHAVIORAL: renderHome -> no theiwise
- T18.AC2: BEHAVIORAL: renderArticle -> no theiwise
- T18.AC3: banned tokens concatenated

### T19: JSON-LD presence on Home + Article [infra]

**Target files:** `test/public-json-ld-presence.test.ts`

**Acceptance Criteria:**

- T19.AC1: BEHAVIORAL: Home contains WebSite + Organization + ItemList
- T19.AC2: BEHAVIORAL: Article with faqs contains Article + BreadcrumbList + FAQPage
- T19.AC3: BEHAVIORAL: Article with empty faqs omits FAQPage

### T20: Image attribute + lazy-load tests [infra]

**Target files:** `test/public-image-attrs.test.ts`

**Acceptance Criteria:**

- T20.AC1: BEHAVIORAL: every <img> has alt+width+height
- T20.AC2: BEHAVIORAL: below-fold images have loading=lazy

### T21: Ad-slot attribute tests [infra]

**Target files:** `test/public-ad-slots.test.ts`

**Acceptance Criteria:**

- T21.AC1: BEHAVIORAL: every ad-slot has data-ad-slot + data-ad-type in {leaderboard,in-feed,rect}
- T21.AC2: BEHAVIORAL: both leaderboard + in-feed present on Home

### T22: Regression: typecheck + verify:no-legacy-prod-refs + verify:infra + verify:worker-config all exit 0 [infra]

**Target files:** `test/verify-scripts-green.test.ts`

**Acceptance Criteria:**

- T22.AC1: tsc --noEmit exit 0
- T22.AC2: verify:no-legacy-prod-refs exit 0
- T22.AC3: verify:infra exit 0
- T22.AC4: verify:worker-config exit 0

## Alternatives Considered

### Where to put home + article rendering

**Chosen:** New subdirs api/src/public/templates/ + api/src/public/view-models/; existing router.ts wires them
**Rationale:** Keeps git diff focused on additive work; spec PART 5 explicitly names templates/ + view-models/ subdirs; rename touches every import site for zero behavioral gain.
**Alternatives:**
- Rename router.ts to public-router.ts (rejected: noisy diff)
- Inline templates as string constants in router.ts (rejected: 2000+ line file, untestable)

### CSS + JS delivery

**Chosen:** Export CSS/JS as TypeScript string modules; serve via dedicated /assets/public.css + /assets/public.js Worker GETs with immutable Cache-Control
**Rationale:** PART 13 requires public JS to be cacheable; exporting from .ts avoids toolchain changes.
**Alternatives:**
- Inline <style>/<script> in templates/layout.ts (rejected: not cacheable, inflates response size)
- Raw .css/.js files imported via build-time text loader (rejected: no bundler text-loader configured in this Worker)

### Body-block adapter for Article

**Chosen:** Adapter reads articles.content_json first; falls back to a synthesized html block wrapping content_html when content_json is null/empty
**Rationale:** Preserves design fidelity for typed-block articles while not breaking legacy raw-HTML articles.
**Alternatives:**
- Only render content_html (rejected: design relies on typed blocks pullquote/figure/callout that cannot be derived from raw HTML)
- Require migration to backfill content_json (rejected: out of scope; PART 0 forbids migrations)

### Newsletter form behavior

**Chosen:** Render <input>+<button> with visually-hidden label; POST to /api/newsletter/subscribe placeholder returning 501; disabled state driven by site.newsletter_settings_json.provider
**Rationale:** Preserves required 13-section structure with accessible disabled state until Session 5+ wires a real provider.
**Alternatives:**
- Hide newsletter entirely when no provider (rejected: PART 1 requires section 11 newsletter)
- Real Mailchimp/Buttondown integration (rejected: explicitly out of scope)

### Cross-site isolation enforcement

**Chosen:** Every view-model helper takes siteId as required positional argument; every D1 query WHERE site_id=?; tests exercise 2 sites with disjoint fixtures
**Rationale:** Explicit positional argument forces every caller (and test) to pass siteId; eliminates the R4 cross-site leak class.
**Alternatives:**
- Encode siteId in Hono context global (rejected: implicit context harder to test)
- Per-tenant D1 binding (rejected: re-litigates Phase 3 multi-site schema)

### Fallback strategy for template render failure

**Chosen:** try/catch around renderArticle; on throw, fall back to legacy c.html(content_html ?? '')
**Rationale:** Preserves the existing /article/:slug contract during the template rollout; logs warning for observability.
**Alternatives:**
- Let exception bubble to a 500 (rejected: silent regression for existing RSS-reader consumers)
- Render an error page (rejected: changes contract for external embeds)

## Risk Assessment


## Rollback Plan

Roll back per-file via `git checkout HEAD -- <path>` for each file in files_expected_to_change. The session is additive only — no migrations, no schema mutation. Reverting router.ts restores the legacy `c.html(content_html ?? '')` path for /article/:slug and removes the GET / + /assets/* + layout-wrapped /category|/page handlers. No data unwinding required.

## Source Pack Summary

_Render-only summary of `source_pack.json` (the typed JSON remains canonical)._

| source_id | source_type | staleness_policy | used_for | evidence_summary |
|---|---|---|---|---|
| SP-USER-1 | user_request |  | mission_intake.notes, mainGoal.text, every_story.target_files, design_contract.conversion_goal | User provided structured Session 4 spec doc with PART 1-PART 16 sections defining the required Home (13 sections) + A... |
| SP-DOCS-1 | local_doc |  | proposal.problem_statement, tasks.story_titles, design_contract.content_blocks | Local copy of the approved implementation spec (cms-new-phase5-2026-05018.md). Sections PART 1 (Home structure), PART... |
| SP-PROBE-1 | code_probe |  | interface_contract.endpoints, field_contract.fields | Direct codebase probe of api/src/public/router.ts, api/src/public/middleware.ts, api/src/site/site-context.ts confirm... |
| SP-PROBE-2 | db_schema |  | field_contract.fields[db_table], field_contract.fields[db_column] | Direct probe of api/migrations/0001-0007 SQL confirming the sites/site_settings/articles/categories/site_categories/c... |

## Interface Contract Summary

_Render-only summary of `interface_contract.json` (the typed JSON remains canonical)._

| name | method | path | request_fields | response_fields | redirect_params | forbidden_substitutes |
|---|---|---|---|---|---|---|
| GetHome | GET | / |  | site_id, site_name, site_tagline, site_logo_url, site_brand_tokens, home_featured_article_slugs, home_chip_category_slugs |  | — |
| GetArticle | GET | /article/:slug | article_slug | site_id, article_slug, article_title, article_content_html, article_published_at, article_category_slug, article_seo_title, article_seo_description |  | — |
| GetPublicCss | GET | /assets/public.css |  |  |  | — |
| GetPublicJs | GET | /assets/public.js |  |  |  | — |
| GetCategory | GET | /category/:slug | article_category_slug | site_id, article_category_slug |  | — |
| GetPage | GET | /page/:slug | article_slug | site_id, article_content_html |  | — |
