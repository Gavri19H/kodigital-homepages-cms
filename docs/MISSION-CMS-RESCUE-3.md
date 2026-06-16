# MISSION-CMS-RESCUE-3 — Post-deploy defect remediation (context doc / change-id seed)

Date: 2026-06-14. Origin: post-deploy forensic audit of the kodigital-cms-rescue-2
deployment (playtrail.net + cms.kodigital.app) against the legacy reference and 5
operator reference screenshots. This document is the COMPLETE source-of-truth
contract for the next /a2z-develop mission. Every defect cites live evidence or a
file:line. The rescue-2 mission passed its gates yet shipped a broken product
because acceptance was isolated unit/grep proofs; this mission's acceptance MUST be
deployed/integrated behavior.

## §0 Red lines (carry forward — non-negotiable)
- Legacy reference is READ-ONLY: /Users/guyhaikov/Projects/kodigital/theiwise-legacy-readonly
  is the UX + logic to MATCH (the 5 reference screenshots are from it). Never modify it.
- AI models LOCKED: gpt-5.5 (text) + gpt-image-2 (image) per api/src/ai/models.ts
  SUPPORTED_TEXT_MODELS / SUPPORTED_IMAGE_MODELS. DO NOT rename them. The image failure
  below is an unsupported REQUEST PARAMETER, not the model id.
- Deploy, secrets, DNS/route mutation: USER-OWNED. Never run wrangler deploy / secret put.
- No production D1 mutation without explicit consent.
- ACCEPTANCE = DEPLOYED BEHAVIOR, not isolated unit greps (see §4).

## §1 Mission goal
A freshly created site (admin -> "Create site" -> automatic 16-step build) must end as
a CORRECT, fully-populated, on-brand site:
- Public homepage rendered through the DESIGN system (hero w/ background image + search +
  real site description, populated featured/trending/latest, category chips, footer) — NOT
  the bare fallback users see today.
- Articles rendered in the design shell, each with a category, an author, a hero/featured
  image, and per-article SEO.
- AI presets that actually DRIVE generation; admin tabs that match the legacy reference in
  field set AND logic.

## §2 Source of truth / evidence base
- Reference screenshots (operator desktop): AI Presets = "Screenshot 2026-06-14 at 15.21.38.png";
  Article editor = "15.28.04.png"; Homepage = "15.42.03.png". Actual (broken) =
  presets "15.23.43.png", article "15.29.56.png", homepage "14.48.23.png".
- Legacy source: theiwise-legacy-readonly/api/src/admin/templates/{presets,articles,settings,pages,categories,media}.ts
  and api/src/ai, api/src/site-provisioning.
- Live: playtrail.net (site st_9fa298851a404064, vertical=parenting); admin cms.kodigital.app
  (CF Access service token in api/.dev.vars).

## §3 Defect inventory (by workstream)

### W1 — Public render: WIRE THE DESIGN SYSTEM (CRITICAL)
Live `/` = 5,714 bytes, 0 <style>, 0 of the 13 sections, 15 bare <article><a> links
(Playwright snapshot + curl). renderHomepageHtml / renderArticleHtml / renderPageHtml
(api/src/public/render-pages.ts:48-137) emit a bare <html> via wrapHtmlDocument and import
NONE of publicCss, renderLayout (templates/layout.ts), renderHome (templates/home.ts),
buildHomeViewModel (view-models/home.ts), or the design templates/article.ts. The entire
C-workstream is unit-tested but ORPHANED from the live route. Article + /page/about
identical (0 <style>).
REQUIRED: the public router/render-pages compose renderLayout + renderHome + the design
article/page templates + publicCss, fed by buildHomeViewModel + site_settings.
ACCEPTANCE: GET / returns the 13 sections, brand color #1ba8c8 + Nunito, a hero with bg
image; article page has .article-shell + header + footer; Playwright screenshot matches
"15.42.03.png".

### W2 — Provisioning autonomy + data correctness (CRITICAL)
- W2.1 warm_homepage_cache (steps.ts:874-927) self-fetches https://{host}/ from inside the
  worker -> Cloudflare 403 loopback -> the step wrapper (steps.ts:917-925) escalates the
  best-effort "skipped" into job FAILED. Steps 15 (smoke) + 16 (update_launch_readiness)
  never run; site stuck status='draft' while publicly serving. LIVE: job failed at step 13;
  error "homepage warm did not complete (status=skipped, http=403)".
  REQUIRED: warm without an external self-fetch (render in-process + KV put), or treat a 403
  as non-fatal; the job must reach update_launch_readiness and flip status to launched.
- W2.2 generate_15_homepage_articles INSERT (steps.ts:680-682) omits category_id,
  author_name, featured_image_id, seo_title, seo_description, AND placement
  (is_featured/is_trending/homepage_rank). LIVE: all 15 articles have those NULL/0
  (with_cat=0, with_author=0, with_img=0, with_seo=0; placement all 0/null).
  REQUIRED: assign category (from allocated site_categories), author (site default/owner),
  placement distribution (1 hero + featured + trending + latest), per-article SEO; set
  featured_image_id once W3.1 restores images.
- W2.3 allocate_vertical_categories (steps.ts:317-381) allocates 3 site_categories but NO
  article is linked (consequence of W2.2) -> category pages + chip-rail empty.
- W2.4 AI tagline/site_description are DISCARDED. create_site_settings seeds deterministic
  stubs first (steps.ts:273-274), then generate_tagline_and_site_description calls
  upsertSiteSetting which is UPDATE-IF-NULL (steps.ts:238-240) -> the AI values (which
  SUCCEEDED on gpt-5.5) never overwrite. LIVE site_settings shows the stubs ("Playtrail —
  your trusted source." / "...trustworthy reporting at playtrail.net.").
  REQUIRED: AI-owned keys must win (reorder, or force-overwrite for AI keys).
- W2.5 brand_tokens_json seeded #0F172A/#38BDF8/#F8FAFC — not the design contract #1ba8c8
  family. Seed from the contract or leave null so contract CSS defaults apply.

### W3 — AI generation reliability (CRITICAL / HIGH)
- W3.1 IMAGE GENERATION 100% BROKEN. openai-client.ts:176 sends response_format:"b64_json"
  in the POST /v1/images/generations body; gpt-image rejects it with HTTP 400 "Unknown
  parameter: 'response_format'". Every image call falls back. LIVE ai_generations:
  feature-image fallback x16, logo-image fallback x1 -> 0 media rows, logo_media_id empty,
  no hero/article images anywhere. FIX: remove the response_format param (the parser at
  openai-client.ts:188-192 already reads data[0].b64_json, which gpt-image returns by
  default). DO NOT change the model id. ACCEPTANCE: a provisioned site has article images +
  logo + hero media rows with R2 objects.
- W3.2 TEXT GENERATION UNRELIABLE for full articles. starter-article fallbacks all carry
  error "The operation was aborted" (timeout). LIVE: 10/15 fallback, 5/15 success; the step
  retried 6 times. Root: DEFAULT_TIMEOUT_MS too low for a full article, and abort/4xx are
  not retried (isRetriableStatus = 429/5xx only, openai-client.ts:71-72). FIX: raise the
  per-task timeout for article generation and/or reduce article scope/streaming; target
  15/15 real articles. Stubs must be surfaced in receipts, never shipped silently.
  (Short tasks — tagline/description/about/plan — succeed on gpt-5.5.)

### W4 — AI Presets: rebuild to the reference (CRITICAL)
new presets.ts (226 lines) vs legacy (1317). Versus reference "15.21.38.png":
- NO Name field (form has only Slug; presets.ts has no name/label/description). Add Name*
  (auto-derives slug) + Description.
- Category is a freeform <input> (presets.ts:190); legacy is a REQUIRED <select> over the
  use-case enum (legacy presets.ts:13-20: title/excerpt/outline/content/seo/image/custom).
  This enum is the routing key.
- Variables = raw "Variables (JSON)" textarea (presets.ts:197); legacy uses {{variable}}
  click-to-insert chips + auto-detect Preview.
- No System Prompt / User Prompt split (legacy :326 / :345); no "Fields to Generate"
  content-mapping (legacy :411-429) — the mechanism that maps a preset to outputs.
- LOGIC: the generators in ai/generators/text.ts (generateStarterArticlePlan/Article,
  :478/:540) and the provisioning steps NEVER read prompt_presets -> presets drive nothing.
REQUIRED: store name+category(enum)+system+user prompts+structured variables+content-mapping;
provisioning AND the editor select the preset by category and use its prompt/model/mapping.
ACCEPTANCE: a created preset is demonstrably used by site provisioning + editor "Use Preset".

### W5 — Article editor: rebuild to the reference (CRITICAL)
new articles.ts (510) vs legacy (4159). Versus reference "15.28.04.png":
- NO Author Name (legacy :319-326, auto-fills user.email when empty) and NO Author Bio
  (legacy :331-337). Add both with the auto-fill rule.
- NO Hero Image card (legacy :342-640: Upload Image / Generate with AI + AI hero modal).
- Content is a textarea labeled "Content (block JSON)" (articles.ts:379-380) with a stripped
  toolbar; legacy is a rich block editor with full toolbar + inline AI (Improve/Expand/SEO/
  Tone) + Quick Actions (Outline/Draft/Rewrite/SEO Meta, legacy :1644-1680).
- Exposes raw Site/Homepage-section/rank/Published-at; legacy uses clean Display Options
  ("Featured Article -> Show in homepage hero section", legacy :431-439).
REQUIRED: port the full editor; wire hero image gen to W3.1; structured-content auto-fill of
author/title/excerpt/meta (legacy :3750-3874).

### W6 — Settings / Pages / Categories field restoration (HIGH / MEDIUM)
- Settings (377 vs 1120): restore Site Logo upload + AI-Generate-Logo panel (legacy :80-177),
  STRUCTURED Newsletter (not the raw "Newsletter Settings (JSON)" textarea, settings.ts:196-204;
  live value {"enabled":false,"provider":"none"}), Items-Per-Page, tab layout.
- Pages (417 vs 403): restore the layout Template select Default/Full-Width/Landing
  (legacy :176-180); stop labeling content "Content (block JSON)" (pages.ts:293).
- Categories (288 vs 356): restore Description, Display Order, Show-on-Homepage
  (legacy :96-107); keep the multi-vertical select.

### W7 — SEO / consistency (MEDIUM)
- Homepage meta description hardcodes "Latest articles on {host}" (render-pages.ts:59) instead
  of site_settings.site_description (resolved by W1 + W2.4).
- Draft sites are publicly served + indexable (routing keys domains.status, not sites.status;
  robots index,follow). Gate public serving/indexing on launch-readiness.
- Minor: site_creation_jobs.total_steps DEFAULT still 15; CF service-token common_name is
  "470cc1...access" not the documented KODIGITAL_CMS_SMOKE_TESTS (fix doc or token); favicon 404.

## §4 Acceptance approach (MANDATORY)
Every story proves INTEGRATED/DEPLOYED behavior, not isolated module units:
- Public: exercise the actual router route (GET / and GET /article/:slug), assert the design
  sections + brand CSS + author + hero are present in the served HTML; Playwright screenshot
  vs reference + empty console.
- Provisioning: run the full 16-step build to completion against a live-like origin; assert
  media rows > 0 (images), articles categorized + authored + placed, AI (not stub) content,
  status=launched.
- Presets: assert the preset's prompt/model/mapping is the one actually used by generation.

## §5 What already works (do NOT rebuild)
Admin shell + 9-nav, Dashboard, Media upload UX (dropzone/preview/progress), Tags, URL
canonicalization (301), sitemap/feed/robots, the AI text engine for short tasks, create-site
form, block-editor plumbing + AI endpoints (/api/admin/ai/chat|image|presets), tenant-scoped
queries.

## §6 Suggested change-id
kodigital-cms-rescue-3-2026-06-14 — ONE /a2z-develop mission. References = this doc + the 5
screenshots + theiwise-legacy-readonly. Decision locked with operator: full remediation in
one mission, then standard /a2z-ship.

## §8 Complete feature inventory + exhaustive acceptance gate (appended after a full code-enumerated re-check of EVERY route, endpoint, tab, step)

### §8.1 Additional defects found in the exhaustive pass
- W1-EXTENDED: /category/:slug also renders BARE (live /category/wellness = 1,279 bytes, 0 <style>). The orphaned-render defect covers home + article + page + CATEGORY. W1 must wire ALL FOUR renderers in render-pages.ts (incl. renderCategoryHtml).
- W2.3-EXTENDED: the parenting site was allocated categories family-travel, healthy-meals, wellness (article_count 0 each) — vertical-mismatched AND empty. Both the category_verticals matrix for the vertical and the article->category assignment must be corrected.
- W3.1-EXTENDED: POST /api/admin/ai/image (ai-api.ts:130) and /api/admin/ai/logo (:136) DO exist (handlers handleAdminAiImage/handleAdminAiLogo) but call the same image client -> they 400/fallback exactly like provisioning. Fixing W3.1 fixes the editor "Generate image" + Settings logo too.
- W7-EXTENDED (NEW): GET /preview/:id returns HTTP 500 {"error":"Preview is not configured"} — the draft-preview feature (T47/G3) is NON-FUNCTIONAL in production; no noindex/no-store render. Must be configured/fixed.
- VERIFIED NON-ISSUE: the apparent duplicate PATCH /articles/:id is a grep-satisfying comment (api.ts:693) + one real IIFE registration (api.ts:711-712). Single correct handler.

### §8.2 Full route/feature surface (rescue-3 acceptance MUST verify every item)
Public: / ; /article/:slug ; /category/:slug ; /category/:slug/page/:page ; /page/:slug ; /:slug (301-or-render) ; /feed.xml ; /atom.xml ; /sitemap.xml ; /robots.txt ; /ads.txt ; /health ; /preview/:id ; /media/* ; /api/privacy/{status,opt-out,opt-in}.
Admin UI: /admin ; /admin/articles (+/new, /:id) ; /admin/pages ; /admin/categories ; /admin/tags ; /admin/media ; /admin/presets (+/new, /:id) ; /admin/settings ; /admin/domains.
Admin API: articles GET(list,:id) POST PATCH:id DELETE:id ; workflow publish/unpublish/schedule/cancel-schedule/archive/versions(/:versionId)/preview-link ; pages GET POST PATCH:id DELETE:id ; categories GET POST PUT:id DELETE:id ; tags GET POST DELETE:id ; media GET POST upload GET:id PUT:id DELETE:id ; settings GET PATCH ; ai chat/image/logo + presets GET/POST/GET:id/PUT:id/DELETE:id/:id/use ; ai-generations GET(list,:id) ; sites GET(list,:id) POST PATCH:id provision/next provision purge-cache ; verticals GET ; domains GET PATCH:id ; auth/status GET.
Provisioning: the 16 STEP_KEYS (validate_domain_in_cloudflare -> ... -> update_launch_readiness).

### §8.3 Exhaustive acceptance gate — DONE means 100%, the mission cannot finish otherwise
This gate is what makes "the final product is fully functional and 100% aligned" verifiable rather than hoped: any defect not caught by inspection is caught here before done, because A-D re-verify every feature against the references on a LIVE provisioned site.

A. Provision a fresh throwaway test site end-to-end through the live 16-step flow; assert it reaches update_launch_readiness, status flips to launched, and:
   - media rows > 0 (article images + logo + hero present; R2 objects resolve);
   - every starter article has category_id, author_name, featured_image_id, seo_title/seo_description, and a placement distribution (>=1 hero + featured + trending + latest);
   - site_settings tagline/site_description/brand carry the AI/contract values (NOT the seed stubs);
   - 0 fallback articles (or fallbacks explicitly surfaced; never shipped silently as content).
B. Public render via Playwright (375px + 1280px, console error-free): /, /article/:slug, /category/:slug, /page/:slug each render the DESIGN (13-/12-section layout, brand #1ba8c8, Nunito, hero with bg image, footer) and screenshot-match the references; /:slug 301; feeds/sitemap/robots/ads valid; /preview/:id returns the draft render with X-Robots-Tag noindex + Cache-Control no-store (NO 500).
C. Admin via Playwright (CF Access): every tab equals the reference screenshots field-by-field — Presets (Name, use-case Category SELECT, System/User prompts, {{var}} chips, content-mapping, Test), Article editor (Author Name auto-fill + Bio, Hero Image upload/generate, rich toolbar + inline AI, clean Display Options), Settings (Site Logo + AI-generate panel, structured Newsletter), Pages (layout Template select), Categories (Description/Order/Show-on-Homepage).
D. API: exercise EVERY verb in §8.2 against the test site — each returns its documented success AND documented error codes (403 tenant, 409 slug, 422 category-invalid); ai/image + ai/logo actually return an image (post W3.1); preset CRUD round-trips and a created preset is demonstrably USED by generation.
E. tsc 0 errors + vitest 0 failures + verify:all exit 0 — NECESSARY but NOT SUFFICIENT. A-D are the binding, deployed-behavior gate.
