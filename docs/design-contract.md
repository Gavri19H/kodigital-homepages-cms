# theiwise Public Design Contract (decoded)

Decoded ONCE (story A5) from the canonical escaped design-tool export
`docs/reference/implementation-spec-standalone.html` and cross-checked against
`docs/reference/theiwise-home-article-implementation-spec.pdf`. Every value in
this document was extracted from those references — never invented, never
recalled from memory. This document is the single value source for all
C-stories (C1–C12): any public design value not already pinned by an existing
test comes FROM here.

Banned-string note: this doc names the `theiwise` brand wordmark and screen
labels only; it never contains protected production hostnames.

## 1. Color tokens (all `--tw-*` values)

| Token: value | Use |
|---|---|
| `--tw-ink: #1a1d23` | Headings, dark sections, footer, trending strip |
| `--tw-text: #2a2f38` | Body copy |
| `--tw-text-muted: #5a6270` | Secondary text, bylines, captions |
| `--tw-text-light: #8a93a3` | Placeholder text, ad slot label, footer brand links |
| `--tw-rule: #e8ecf2` | Card borders, dividers |
| `--tw-rule-soft: #f1f4f8` | Inner dividers, image placeholders |
| `--tw-bg: #ffffff` | Page background |
| `--tw-bg-soft: #f7f9fc` | Soft section background, ad slot |
| `--tw-bg-tint: #eef5f8` | Tinted background variant |
| `--tw-brand: #1ba8c8` | Primary brand. Logo bg, CTAs, links, active states, the pulse dot, list bullets |
| `--tw-brand-deep: #0f8aa6` | Hover state for primary buttons |
| `--tw-brand-soft: #d6eef5` | Newsletter card border, FAQ open border |
| `--tw-brand-tint: #f0f9fc` | Newsletter background, callout box, focus ring |
| `--tw-accent: #f0a830` | Warm accent — author avatars, badges |
| `--tw-success: #10b981` | Reserved for success states |

The 5 brand hex values: `#1ba8c8` (brand), `#0f8aa6` (brand-deep),
`#d6eef5` (brand-soft), `#f0f9fc` (brand-tint), `#f0a830` (accent).

## 2. Typography tokens

| Token | Stack | Use |
|---|---|---|
| `--tw-font-sans` | "Nunito Sans", "Inter", system-ui | Body, UI, byline, meta |
| `--tw-font-display` | "Nunito", "Nunito Sans", system-ui | All headings (h1–h4), card titles, logo, numbered counters |

Headings: weight 800 default, `letter-spacing: -0.015em`, `line-height: 1.18`.
Hero/article titles bump to 900 at `-0.02em`.

Type scale (rem / px at root 16):

| Token | rem | px | Use |
|---|---|---|---|
| `--tw-fs-xs` | 0.75 | 12 | Eyebrows, ad labels, byline meta |
| `--tw-fs-sm` | 0.875 | 14 | Nav, byline, story-row body, sidebar items |
| `--tw-fs-base` | 1.0 | 16 | Body default, trending headline |
| `--tw-fs-md` | 1.0625 | 17 | Card title, hero search input, picks excerpt |
| `--tw-fs-lg` | 1.25 | 20 | Brand name, sidebar newsletter h4 |
| `--tw-fs-xl` | 1.625 | 26 | Editor's-pick hero card title, featured hero card title |
| `--tw-fs-2xl` | 2.0 | 32 | Section titles (max) |
| `--tw-fs-3xl` | 2.625 | 42 | Hero title (clamped) |
| `--tw-fs-4xl` | 3.25 | 52 | Hero title max |

Article body copy: `1.125rem / 1.7`. Article-body H2: `1.75rem / 1.2`, weight 800.

## 3. Layout & shape tokens

| Token: value | Use |
|---|---|
| `--tw-container: 1200px` | Standard container max-width |
| `--tw-container-narrow: 920px` | Reading-width container (article) |
| `--tw-radius-sm: 6px` | Tight corners |
| `--tw-radius: 10px` | Cards, buttons (squared), chips, ad slots |
| `--tw-radius-lg: 16px` | Newsletter card, callout box |
| `--tw-radius-pill: 999px` | Buttons, search inputs, category pill on article hero |
| `--tw-shadow-sm: 0 1px 2px rgba(20,30,50,0.04), 0 1px 1px rgba(20,30,50,0.03)` | Card resting |
| `--tw-shadow: 0 2px 8px rgba(20,30,50,0.05), 0 1px 2px rgba(20,30,50,0.04)` | Search focus, rail arrow |
| `--tw-shadow-md: 0 8px 24px rgba(20,30,50,0.08), 0 2px 4px rgba(20,30,50,0.04)` | Card hover, floating-next button, hero search |
| `--tw-header-h: 72px` | Sticky header height |

Container utility:
`.container { max-width: var(--tw-container); margin: 0 auto; padding: 0 clamp(16px, 3vw, 32px); }`

## 4. Motion tokens

| Token | Value | Use |
|---|---|---|
| `--tw-ease` | `cubic-bezier(.2,.7,.2,1)` | Default easing |
| `--tw-dur` | `200ms` | Default duration for hover/transition |

Card hover lifts 4px (`translateY(-4px)`) with `--tw-shadow-md`. Buttons lift
1px. The pulse dot animates `1.6s ease-out infinite`, scaling 0.6 → 1.6 with
opacity 0.5 → 0.

## 5. Contract grids

| Grid | `grid-template-columns` | Where |
|---|---|---|
| Article shell (3-col) | `60px minmax(0, 1fr) 320px` | `.article-shell`; gap `clamp(24px, 4vw, 56px)`; `align-items: start` |
| Featured row | `1.4fr 1fr 1fr` | `.featured` three-card row; first card enlarged (16/10 image, `--tw-fs-xl` title) |
| Footer top | `1.4fr 1fr 1fr 1fr` | `.site-footer` brand block + 3 link columns |
| Editor's Picks | `1.4fr 1fr` | `.picks-grid` hero card + story-row stack |
| Trending | `repeat(5, 1fr)` | `.trending-section` 5-column grid |
| Spotlight / Related | 4-col card grid | `.grid.grid-4` |
| Latest | 3-col card grid | `.grid.grid-3` |
| Newsletter | `1fr 1fr` | `.newsletter` two-column card |

Article shell responsive overrides (the body column's `minmax(0, 1fr)` is
non-negotiable — without it long words/pre tags blow out the grid):

- `@media (max-width: 1080px)` → `.article-shell { grid-template-columns: minmax(0, 1fr) 300px; }` AND `.share-rail { display: none !important; }`
- `@media (max-width: 800px)` → `.article-shell { grid-template-columns: 1fr; }`; `.article-sidebar { order: 2; }`

## 6. Root wrappers (screen labels)

- Home root: `<div data-screen-label="theiwise-home">`
- Article root: `<div data-screen-label="article-page">`

## 7. Home section order (13 sections, exact sequence)

| # | Component | Root selector |
|---|---|---|
| 1 | Header | `.site-header` (sticky) |
| 2 | Hero | `.hero` (full-bleed, centered) |
| 3 | ChipRail | `.container > .cat-rail` |
| 4 | Featured | `.container.section > .featured` |
| 5 | Ad (leaderboard) | `.ad-slot--leaderboard` (970×90) |
| 6 | EditorsPicks | `.container.section > .picks-grid` |
| 7 | Trending | `.trending-section` (dark, full-bleed) |
| 8 | Spotlight | `.section.section--soft > .grid.grid-4` |
| 9 | Ad (in-feed) | `.ad-slot--in-feed` (728×90) |
| 10 | Latest | `.container.section > .grid.grid-3` |
| 11 | Newsletter | `.newsletter` |
| 12 | Footer | `.site-footer` |
| 13 | FloatingNext | `.floating-next` (fixed; hidden < 1280px) |

There is NO "about" section on the home page.

## 8. Article section order (12 sections) + nesting

| # | Component | Root selector | Nesting |
|---|---|---|---|
| 1 | ReadingProgress | `.reading-progress` | index 0, fixed top, 3px bar |
| 2 | Header | `.site-header` | same pattern as Home |
| 3 | ArticleHero | `.article-hero` | full-bleed, dark gradient overlay |
| 4 | ArticleShell | `.article-shell.container` | wrapper for 5–9 |
| 5 | ShareRail | `.share-rail` | inside shell; sticky `top: 100px`; hidden < 1080px |
| 6 | ArticleBody | `article.article-body` | inside shell; holds sponsor-disclosure, body blocks, 7, 8 |
| 7 | FAQs | `.faq-section` | nested inside `.article-body` |
| 8 | ShareBottom | `.article-share-bottom` | nested inside `.article-body` |
| 9 | Sidebar | `.article-sidebar` | inside shell; sticky; below body < 800px |
| 10 | Related | `.related-section` | soft-bg, `.grid.grid-4` |
| 11 | Newsletter | `.newsletter` | reused from home |
| 12 | Footer | `.site-footer` | reused from home |

## 9. Breakpoints (all 8)

| Breakpoint | What changes |
|---|---|
| ≥ 1280px | Floating "Next" button visible (hidden below) |
| 1080px | Article: share rail hides, sidebar narrows to 300px |
| 980px | Home: `.grid-3`, `.grid-4`, `.featured` drop to 2 columns; Trending switches to horizontal scroller (240px-min items) |
| 880px | Header: search hides, nav labels hide (icons only); Editor's Picks collapses to single column |
| 800px | Article: sidebar moves below body; Footer drops to 2 columns |
| 760px | Newsletter card stacks (1 column) |
| 560px | Home: all card grids collapse to single column |
| 480px | Footer drops to 1 column |

## 10. Class vocabulary

- Header: `site-header`, `brand`, `header-search`, `header-nav`, `nav-link`, `btn-outline`
- Hero: `hero`, `hero-bg`, `hero-content`, `hero-title`, `tagline`, `hero-search`
- ChipRail: `cat-rail`, `cat-chip`, `cat-chip-img`, `cat-chip-label`
- Featured: `featured` (+ `card` primitive)
- Editor's Picks: `picks-grid`, `picks-hero`, `picks-excerpt`, `story-row` (children `img`, `body`, `meta`)
- Trending: `trending-section`, `trending-num`, `trending-img`, `trending-cat`, `trending-h`, `pulse-dot`
- Spotlight: `section--soft`, `grid`, `grid-4`
- Latest: `grid-3`, `card-byline`
- Newsletter: `newsletter`
- Footer: `site-footer`
- FloatingNext: `floating-next`
- Ad slots: `ad-slot`, `ad-slot--leaderboard`, `ad-slot--in-feed`, `ad-slot--rect` (300×250, article sidebar); attributes `data-ad-slot`, `data-ad-type`
- Article: `reading-progress`, `reading-progress-bar`, `article-hero`, `article-hero-img`, `article-hero-overlay`, `article-hero-content`, `article-cat`, `article-title`, `article-subtitle`, `article-meta`, `article-meta-text`, `article-byline`, `article-date`, `article-shell`, `share-rail`, `share-btn`, `share-count`, `article-body`, `faq-section`, `article-sidebar`, `sidebar-card`, `toc`, `sidebar-newsletter`, `sidebar-ad`, `sidebar-popular`, `article-share-bottom`, `related-section`
- Shared: `card`, `card-img`, `card-pin`, `card-body`, `card-title`, `card-foot`, `card-byline`, `card-avatar`, `is-brand`, `btn-primary`, `btn-outline`, `section-head`, `ph`, `pop-img`

## 11. Pinned component values

- Header: sticky, height `var(--tw-header-h)`, white-with-blur background, 1px bottom rule. Children in order: `.brand` (38px square logo, brand-bg, white house glyph + wordmark "theiwise"), `.header-search` (pill input, max-width 460px, focus ring uses `var(--tw-brand-tint)`), `.header-nav` (Explore w/ chevron, Trending, Editor's Picks, Newsletter, then `.btn-outline` "Sign in"). Below 880px: hide search, icon-only nav, gap 12px.
- Hero: full-bleed, `min-height: clamp(340px, 42vw, 480px)`; DOM `.hero > .hero-bg + .hero-content > h1.hero-title > span.tagline` + `form.hero-search`. Title clamps `2.25rem → 5.5vw → 3.25rem`, weight 800, line-height 1.05, white with text-shadow. Tagline `display: block`, `0.62em`, weight 700. Search button 48×48 pill, brand bg.
- `.cat-chip`: min-width `168px`, gap 16px, scroll-snap on; hover lifts 2px and switches border to `var(--tw-brand)`.
- `.trending-section`: background `var(--tw-ink)`; `.trending-num` = `String(i+1).padStart(2, "0")`, 2rem display, weight 900, brand color; `.trending-cat` uppercase eyebrow brand color; `.trending-h` 1rem display weight 800 white.
- `.pulse-dot`: 12px circle, color `var(--tw-brand)`, 1.6s pulse keyframe.
- `.floating-next`: fixed 64×64 circle, right-edge midpoint, white bg, brand chevron.
- `.reading-progress`: 3px fixed top bar; on scroll apply `transform: scaleX(pct)` with `transform-origin: left center` to `.reading-progress-bar`; passive scroll listener.
- Article hero: `min-height: clamp(340px, 44vw, 520px)`; `.article-cat` pill 12px uppercase 0.12em brand bg; `.article-title` `clamp(2rem, 5vw, 3.5rem)` weight 900 max-width 22ch; `.article-subtitle` `clamp(1.05rem, 1.6vw, 1.25rem)` weight 500 max-width 56ch.
- `.article-body`: `1.125rem / 1.7`, max-width 680px; drop cap `p:first-of-type::first-letter` 4.2em weight 900 brand color; `ul > li` custom 16×2px brand dash bullet, padding-left 28px.
- `.share-rail`: 3 share buttons (44×44 circles, aria-labels Save / Share / Copy link) + `.share-count`; hover border+color brand, lifts 2px.
- Sidebar cards in order: `.sidebar-card + .toc` (numbered TOC, decimal-leading-zero counter, brand numbers), `.sidebar-newsletter`, `.sidebar-ad.ad-slot--rect`, `.sidebar-card + .sidebar-popular` (60×60 thumbs).
- FAQs: native `details`/`summary`; border `1px solid var(--tw-rule)`; open state `var(--tw-brand-soft)` border + sm shadow; chevron rotates 180deg brand; native marker hidden.
- Buttons: `.btn-primary` pill brand bg white text weight 700, hover brand-deep lift 1px; `.btn-outline` pill 1.5px brand border brand text, hover solid brand fill white text. Both `--tw-fs-sm`; padding outline 9/22, primary 11/24.
- Card states: resting `--tw-shadow-sm` + 1px `var(--tw-rule)` border; hover `translateY(-4px)` + `--tw-shadow-md`, title → brand, pin fades in.

## 12. View-model buckets (data contracts)

Home (`window.TIW_DATA`) — each top-level key maps 1:1 to a section:
`brand { name, heroTitle, heroSubtitle, searchPlaceholder }`, `chips[]`,
`featured[]` (3 items, first is hero), `editorsPicks { hero, thumbs[3] }`,
`trending[]` (5 items), `spotlight { cat, desc, items[4] }`, `latest[]` (6 items).

Article (`window.TIW_ARTICLE`): `category`, `kicker`, `title`, `subtitle`,
`author { name, brand?, initial?, color? }`, `publishedAt`, `readTime`,
`sponsored | null`, `hero`, `body[]` (block types: `p`, `h2`, `ul`,
`pullquote`, `image`, `callout`, `affiliate`), `faqs[]`, `related[]` (4),
`popular[]` (3, sidebar).
