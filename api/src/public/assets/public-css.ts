// Phase 5 generic Home + Article public stylesheet, served at /assets/public.css.
// PART 3 tokens (--tw-*) and PART 4 breakpoints from the approved spec
// (cms-new-phase5-2026-05018.md). Per-site brand_tokens_json overrides the
// --tw-* tokens via a <style> block in renderLayout (T3). This module is a
// string export so the Worker can ship it without a bundler step.

export const publicCss: string = `
:root {
  /* PART 3 -- color tokens */
  --tw-ink: #0f172a;
  --tw-text: #1f2937;
  --tw-text-muted: #475569;
  --tw-text-light: #94a3b8;
  --tw-rule: #e2e8f0;
  --tw-rule-soft: #f1f5f9;
  --tw-bg: #ffffff;
  --tw-bg-soft: #f8fafc;
  --tw-bg-tint: #eef2f7;
  --tw-brand: #1ba8c8;
  --tw-brand-deep: #0f8aa6;
  --tw-brand-soft: #d6eef5;
  --tw-brand-tint: #f0f9fc;
  --tw-accent: #f0a830;
  --tw-success: #10b981;
  --tw-brand-shadow-rgb: 27, 168, 200;
  /* PART 3 -- typography tokens */
  --tw-font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --tw-font-display: "Inter", var(--tw-font-sans);
  --tw-fs-xs: 0.75rem;
  --tw-fs-sm: 0.875rem;
  --tw-fs-base: 1rem;
  --tw-fs-md: 1.125rem;
  --tw-fs-lg: 1.25rem;
  --tw-fs-xl: 1.5rem;
  --tw-fs-2xl: 1.875rem;
  --tw-fs-3xl: 2.25rem;
  --tw-fs-4xl: 3rem;
  /* PART 3 -- layout tokens */
  --tw-container: 1200px;
  --tw-container-narrow: 880px;
  --tw-radius-sm: 4px;
  --tw-radius: 8px;
  --tw-radius-lg: 16px;
  --tw-radius-pill: 999px;
  --tw-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
  --tw-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  --tw-shadow-md: 0 8px 24px rgba(15, 23, 42, 0.12);
  --tw-header-h: 64px;
  --tw-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --tw-dur: 200ms;
}

*, *::before, *::after { box-sizing: border-box; }
html { color-scheme: light; }
body {
  margin: 0;
  font-family: var(--tw-font-sans);
  font-size: var(--tw-fs-base);
  color: var(--tw-text);
  background: var(--tw-bg);
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}

a { color: var(--tw-brand); text-decoration: none; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--tw-brand); outline-offset: 2px; border-radius: var(--tw-radius-sm); }
img { max-width: 100%; height: auto; }
[id] { scroll-margin-top: 88px; }

.skip-to-content {
  position: absolute; left: -9999px; top: -9999px;
  background: var(--tw-ink); color: #fff; padding: 0.5rem 1rem;
  border-radius: var(--tw-radius); z-index: 1000;
}
.skip-to-content:focus { left: 1rem; top: 1rem; }

.container { max-width: var(--tw-container); margin: 0 auto; padding: 0 1rem; }
.container--narrow { max-width: var(--tw-container-narrow); }
.section { padding: 2.5rem 0; }
.section--soft { background: var(--tw-bg-soft); }
.section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1.5rem; }
.section-head h2 { font-family: var(--tw-font-display); font-size: var(--tw-fs-2xl); margin: 0; color: var(--tw-ink); }

.grid { display: grid; gap: 1.25rem; }
.grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }

.site-header {
  position: sticky; top: 0; z-index: 50;
  background: var(--tw-bg); border-bottom: 1px solid var(--tw-rule);
  height: var(--tw-header-h);
  display: flex; align-items: center;
}
.site-header .container { width: 100%; display: flex; align-items: center; gap: 1rem; }
.brand { display: flex; align-items: center; gap: 0.5rem; color: var(--tw-ink); font-weight: 700; }
.brand-logo { width: 32px; height: 32px; border-radius: var(--tw-radius-sm); object-fit: contain; }
.brand-name { font-family: var(--tw-font-display); font-size: var(--tw-fs-lg); }
.header-search { flex: 1; max-width: 360px; }
.header-search input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid var(--tw-rule); border-radius: var(--tw-radius-pill); font-size: var(--tw-fs-sm); }
.header-nav { display: flex; gap: 1rem; align-items: center; }
.header-nav a { color: var(--tw-text); font-size: var(--tw-fs-sm); }

.hero { position: relative; padding: 3rem 0 2.5rem; background: linear-gradient(180deg, var(--tw-brand-tint), var(--tw-bg)); }
.hero-bg { position: absolute; inset: 0; opacity: 0.15; pointer-events: none; }
.hero-content { position: relative; max-width: 720px; }
.hero-title { font-family: var(--tw-font-display); font-size: var(--tw-fs-3xl); color: var(--tw-ink); margin: 0 0 0.5rem; }
.tagline { color: var(--tw-text-muted); font-size: var(--tw-fs-md); margin: 0 0 1.25rem; }
.hero-search { display: flex; gap: 0.5rem; }
.hero-search input { flex: 1; padding: 0.75rem 1rem; border: 1px solid var(--tw-rule); border-radius: var(--tw-radius-pill); font-size: var(--tw-fs-base); }
.hero-search button { padding: 0.75rem 1.25rem; border: 0; border-radius: var(--tw-radius-pill); background: var(--tw-brand); color: #fff; font-weight: 600; cursor: pointer; }

.cat-rail { display: flex; gap: 0.75rem; overflow-x: auto; padding: 0.5rem 0 1rem; scroll-snap-type: x mandatory; }
.cat-chip { display: inline-flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; background: var(--tw-bg); border: 1px solid var(--tw-rule); border-radius: var(--tw-radius-pill); padding: 0.375rem 0.75rem; color: var(--tw-ink); scroll-snap-align: start; }
.cat-chip-img { width: 24px; height: 24px; border-radius: var(--tw-radius-pill); object-fit: cover; }
.cat-chip-label { font-size: var(--tw-fs-sm); }

.featured { padding: 2rem 0; }
.featured .grid { grid-template-columns: 2fr 1fr 1fr; }
.featured .card:first-child { grid-row: span 2; }

.card { background: var(--tw-bg); border: 1px solid var(--tw-rule); border-radius: var(--tw-radius-lg); overflow: hidden; display: flex; flex-direction: column; transition: box-shadow var(--tw-dur) var(--tw-ease); }
.card:hover { box-shadow: var(--tw-shadow); }
.card-img { aspect-ratio: 16/9; object-fit: cover; width: 100%; background: var(--tw-bg-tint); }
.card-title { font-family: var(--tw-font-display); font-size: var(--tw-fs-md); color: var(--tw-ink); margin: 0.75rem 1rem 0.25rem; line-height: 1.3; }
.card-foot { display: flex; justify-content: space-between; padding: 0.5rem 1rem 1rem; color: var(--tw-text-muted); font-size: var(--tw-fs-xs); }
.card-byline { color: var(--tw-text-muted); }

.picks-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; }
.picks-hero { display: flex; flex-direction: column; gap: 0.75rem; }
.picks-excerpt { color: var(--tw-text-muted); font-size: var(--tw-fs-sm); margin: 0; }
.story-row { display: grid; grid-template-columns: 88px 1fr; gap: 0.75rem; padding: 0.5rem 0; border-top: 1px solid var(--tw-rule-soft); }
.story-row:first-child { border-top: 0; }
.story-row img { width: 88px; height: 64px; object-fit: cover; border-radius: var(--tw-radius-sm); }

.trending-section { position: relative; }
.pulse-dot { display: inline-block; width: 8px; height: 8px; border-radius: var(--tw-radius-pill); background: var(--tw-success); margin-right: 0.5rem; animation: pulse 1.6s var(--tw-ease) infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

.newsletter { padding: 2.5rem 0; background: var(--tw-bg-tint); }
.newsletter form { display: flex; gap: 0.5rem; max-width: 480px; }
.newsletter input { flex: 1; padding: 0.75rem 1rem; border: 1px solid var(--tw-rule); border-radius: var(--tw-radius); font-size: var(--tw-fs-base); }
.newsletter button { padding: 0.75rem 1.25rem; border: 0; border-radius: var(--tw-radius); background: var(--tw-ink); color: #fff; font-weight: 600; }
.newsletter button[aria-disabled="true"] { background: var(--tw-text-light); cursor: not-allowed; }
.newsletter-label-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

.site-footer { padding: 2rem 0; background: var(--tw-ink); color: #cbd5e1; margin-top: 3rem; }
.site-footer a { color: #e2e8f0; }
.site-footer .grid-4 { gap: 2rem; }

.floating-next { position: fixed; right: 1.5rem; bottom: 1.5rem; background: var(--tw-brand); color: #fff; padding: 0.75rem 1rem; border-radius: var(--tw-radius-pill); box-shadow: var(--tw-shadow-md); z-index: 30; }

.ad-slot { display: block; margin: 1.5rem auto; background: var(--tw-bg-soft); border: 1px dashed var(--tw-rule); border-radius: var(--tw-radius); text-align: center; padding: 1rem; color: var(--tw-text-light); font-size: var(--tw-fs-xs); }
.ad-slot[data-ad-type="leaderboard"] { min-height: 90px; max-width: 970px; }
.ad-slot[data-ad-type="in-feed"]    { min-height: 120px; }
.ad-slot[data-ad-type="rect"]       { min-height: 250px; max-width: 300px; }

.reading-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; background: transparent; z-index: 60; }
.reading-progress-bar { height: 100%; width: 0%; background: var(--tw-brand); transition: width 80ms linear; }

.article-hero { position: relative; min-height: 320px; }
.article-hero-img { width: 100%; height: 320px; object-fit: cover; }
.article-hero-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15,23,42,0) 40%, rgba(15,23,42,0.7)); }
.article-hero-content { position: absolute; bottom: 1rem; left: 0; right: 0; padding: 0 1rem; color: #fff; }
.article-cat { display: inline-block; background: var(--tw-brand); color: #fff; font-size: var(--tw-fs-xs); padding: 0.25rem 0.5rem; border-radius: var(--tw-radius-pill); }
.article-title { font-family: var(--tw-font-display); font-size: var(--tw-fs-3xl); margin: 0.5rem 0; line-height: 1.15; }
.article-subtitle { font-size: var(--tw-fs-md); margin: 0; opacity: 0.9; }
.article-meta { display: flex; gap: 1rem; flex-wrap: wrap; font-size: var(--tw-fs-sm); color: var(--tw-text-muted); padding: 1rem 0; }
.article-meta-text { color: var(--tw-text-muted); }
.article-byline { font-weight: 600; color: var(--tw-text); }
.article-date { color: var(--tw-text-muted); }

/* PART 4: Article body column MUST use minmax(0, 1fr) so long links/code do not blow the grid. */
.article-shell { display: grid; grid-template-columns: 64px minmax(0, 1fr) 320px; gap: 2rem; padding: 2rem 0; }
.share-rail { position: sticky; top: calc(var(--tw-header-h) + 1rem); display: flex; flex-direction: column; gap: 0.5rem; }
.share-btn { width: 40px; height: 40px; border-radius: var(--tw-radius-pill); border: 1px solid var(--tw-rule); background: var(--tw-bg); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.share-btn[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.share-count { font-size: var(--tw-fs-xs); color: var(--tw-text-muted); text-align: center; }

.article-body { font-size: var(--tw-fs-md); line-height: 1.7; color: var(--tw-text); }
.article-body p { margin: 0 0 1.25em; }
.article-body h2 { font-family: var(--tw-font-display); font-size: var(--tw-fs-xl); color: var(--tw-ink); margin: 2em 0 0.5em; }
.article-body ul { padding-left: 1.25em; list-style: none; }
.article-body ul > li { position: relative; padding-left: 1em; }
.article-body ul > li::before { content: ""; position: absolute; left: 0; top: 0.55em; width: 6px; height: 6px; background: var(--tw-brand); border-radius: var(--tw-radius-pill); }
.article-body ol { padding-left: 1.25em; }
.sponsor-disclosure { font-size: var(--tw-fs-xs); color: var(--tw-text-muted); border-left: 3px solid var(--tw-accent); padding: 0.25em 0.75em; margin: 0 0 1em; }
.pullquote { font-family: var(--tw-font-display); font-size: var(--tw-fs-xl); color: var(--tw-ink); border-left: 4px solid var(--tw-brand); padding: 0.5em 1em; margin: 1.5em 0; }
.article-figure { margin: 1.5em 0; }
.article-figure img { border-radius: var(--tw-radius); }
.article-figure figcaption { color: var(--tw-text-muted); font-size: var(--tw-fs-sm); margin-top: 0.5em; }
.callout-box { background: var(--tw-bg-tint); border-radius: var(--tw-radius); padding: 1em 1.25em; margin: 1.5em 0; }
.affiliate-card { background: var(--tw-bg); border: 1px solid var(--tw-rule); border-radius: var(--tw-radius-lg); padding: 1em; margin: 1.5em 0; box-shadow: var(--tw-shadow-sm); }

.faq-section { padding: 2rem 0; }
.faq-section details { border-top: 1px solid var(--tw-rule); padding: 0.75rem 0; }
.faq-section summary { font-weight: 600; cursor: pointer; }

.article-share-bottom { display: flex; gap: 0.5rem; padding: 1rem 0; border-top: 1px solid var(--tw-rule); }

.article-sidebar { display: flex; flex-direction: column; gap: 1.25rem; }
.sidebar-card { background: var(--tw-bg); border: 1px solid var(--tw-rule); border-radius: var(--tw-radius); padding: 1rem; }
.toc ol { padding-left: 1.25em; margin: 0.25em 0 0; }
.sidebar-newsletter input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid var(--tw-rule); border-radius: var(--tw-radius); }
.sidebar-ad { padding: 0; background: transparent; border: 0; }
.sidebar-popular ol { padding-left: 1.25em; margin: 0; }

.related-section { padding: 2.5rem 0; }

/* PART 4 -- responsive breakpoints (must match the approved spec exactly). */
@media (max-width:1280px) {
  .floating-next { display: none; }
}
@media (max-width:1080px) {
  .article-shell { grid-template-columns: minmax(0, 1fr) 300px; }
  .article-shell .share-rail { display: none; }
}
@media (max-width:980px) {
  .grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .featured .grid { grid-template-columns: 1fr 1fr; }
  .trending-section .grid { display: flex; gap: 1rem; overflow-x: auto; scroll-snap-type: x mandatory; }
  .trending-section .grid > * { flex: 0 0 75%; scroll-snap-align: start; }
}
@media (max-width:880px) {
  .header-search { display: none; }
  .header-nav a { display: none; }
  .picks-grid { grid-template-columns: 1fr; }
}
@media (max-width:800px) {
  .article-shell { grid-template-columns: minmax(0, 1fr); }
  .site-footer .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width:760px) {
  .newsletter form { flex-direction: column; }
}
@media (max-width:560px) {
  .grid-3 { grid-template-columns: minmax(0, 1fr); }
  .grid-4 { grid-template-columns: minmax(0, 1fr); }
  .featured .grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width:480px) {
  .site-footer .grid-4 { grid-template-columns: minmax(0, 1fr); }
}
`;

export default publicCss;
