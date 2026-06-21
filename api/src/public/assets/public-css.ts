// Phase 5 generic Home + Article public stylesheet, served at /assets/public.css.
//
// RESCUE-4 RE-SKIN (2026-06-21): the HOME-page CSS below is the claude.ai
// design styles.css VERBATIM (the authoritative design system — :root tokens,
// reset, header, hero, cat-rail, section, card, grid, picks, trending,
// spotlight, story-row, featured, newsletter, ad-slot, footer, floating-next,
// recommends badge, .ph placeholder). The ARTICLE-page rules the design
// styles.css does not carry (.reading-progress, .article-*, .share-rail,
// .pullquote, .callout-box, .affiliate-card, .faq-section, .sidebar-*, .pop-*,
// .toc, .related-section) are PRESERVED below the home CSS, and the article
// slices of the @media breakpoint blocks are merged in. Net: design home CSS +
// retained article CSS, one stylesheet.
//
// PART 3 tokens (--tw-*) come from the design :root. Per-site brand_tokens_json
// overrides the --tw-* tokens via a <style> block in renderLayout (T3). This
// module is a string export so the Worker can ship it without a bundler step.

export const publicCss: string = `
:root {
  /* === COLOR — Bright, clean, friendly (design styles.css) === */
  --tw-ink: #1a1d23;
  --tw-text: #2a2f38;
  --tw-text-muted: #5a6270;
  --tw-text-light: #8a93a3;
  --tw-rule: #e8ecf2;
  --tw-rule-soft: #f1f4f8;

  --tw-bg: #ffffff;
  --tw-bg-soft: #f7f9fc;
  --tw-bg-tint: #eef5f8;

  /* Brand — swap THIS hue per vertical */
  --tw-brand: #1ba8c8;
  --tw-brand-deep: #0f8aa6;
  --tw-brand-soft: #d6eef5;
  --tw-brand-tint: #f0f9fc;

  --tw-accent: #f0a830;
  --tw-success: #10b981;
  /* retained: rgba helper consumed by article share/hover shadows */
  --tw-brand-shadow-rgb: 27, 168, 200;

  /* === TYPE — Sans-serif system === */
  --tw-font-sans: "Nunito Sans", "Inter", system-ui;
  --tw-font-display: "Nunito", "Nunito Sans", system-ui;

  --tw-fs-xs: 0.75rem;
  --tw-fs-sm: 0.875rem;
  --tw-fs-base: 1rem;
  --tw-fs-md: 1.0625rem;
  --tw-fs-lg: 1.25rem;
  --tw-fs-xl: 1.625rem;
  --tw-fs-2xl: 2rem;
  --tw-fs-3xl: 2.625rem;
  --tw-fs-4xl: 3.25rem;

  /* === LAYOUT === */
  --tw-container: 1200px;
  --tw-container-narrow: 920px;
  --tw-radius-sm: 6px;
  --tw-radius: 10px;
  --tw-radius-lg: 16px;
  --tw-radius-pill: 999px;
  --tw-shadow-sm: 0 1px 2px rgba(20,30,50,0.04), 0 1px 1px rgba(20,30,50,0.03);
  --tw-shadow: 0 2px 8px rgba(20,30,50,0.05), 0 1px 2px rgba(20,30,50,0.04);
  --tw-shadow-md: 0 8px 24px rgba(20,30,50,0.08), 0 2px 4px rgba(20,30,50,0.04);

  --tw-header-h: 72px;
  --tw-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  --tw-dur: 200ms;
}

/* === RESET === */
*,*::before,*::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; color-scheme: light; }
body {
  margin: 0;
  background: var(--tw-bg);
  color: var(--tw-text);
  font-family: var(--tw-font-sans);
  font-size: var(--tw-fs-base);
  line-height: 1.55;
}
img { max-width: 100%; height: auto; display: block; }
a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
h1,h2,h3,h4,h5,h6 { margin: 0; font-family: var(--tw-font-display); font-weight: 800; line-height: 1.18; letter-spacing: -0.015em; color: var(--tw-ink); }
p { margin: 0; }
:focus-visible { outline: 2px solid var(--tw-brand); outline-offset: 2px; border-radius: var(--tw-radius-sm); }
[id] { scroll-margin-top: 88px; }

.skip-to-content {
  position: absolute; left: -9999px; top: -9999px;
  background: var(--tw-ink); color: #fff; padding: 0.5rem 1rem;
  border-radius: var(--tw-radius); z-index: 1000;
}
.skip-to-content:focus { left: 1rem; top: 1rem; }

.container { max-width: var(--tw-container); margin: 0 auto; padding: 0 clamp(16px, 3vw, 32px); }
.container-narrow { max-width: var(--tw-container-narrow); margin: 0 auto; padding: 0 clamp(16px, 3vw, 32px); }
.container--narrow { max-width: var(--tw-container-narrow); }

/* === HEADER === */
.site-header {
  position: sticky; top: 0; z-index: 50;
  background: rgba(255,255,255,0.96);
  backdrop-filter: saturate(180%) blur(10px);
  -webkit-backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid var(--tw-rule);
}
.header-inner {
  display: flex; align-items: center;
  height: var(--tw-header-h);
  gap: clamp(16px, 2.5vw, 32px);
}
.brand {
  display: inline-flex; align-items: center; gap: 8px;
  flex-shrink: 0;
}
.brand-logo {
  width: 38px; height: 38px;
  background: var(--tw-brand);
  border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 900; font-size: 20px;
  box-shadow: 0 2px 6px rgba(27,168,200,0.25);
}
.brand-name {
  font-family: var(--tw-font-display);
  font-size: 1.25rem; font-weight: 800;
  color: var(--tw-ink); letter-spacing: -0.01em;
}

.header-search {
  flex: 1; max-width: 460px;
  display: flex; align-items: center; gap: 10px;
  background: var(--tw-bg-soft);
  border: 1px solid var(--tw-rule);
  border-radius: var(--tw-radius-pill);
  padding: 10px 18px;
  transition: all var(--tw-dur) var(--tw-ease);
}
.header-search:focus-within { border-color: var(--tw-brand); background: #fff; box-shadow: 0 0 0 4px var(--tw-brand-tint); }
.header-search input {
  flex: 1; border: 0; background: transparent; outline: none;
  font: inherit; font-size: var(--tw-fs-sm); color: var(--tw-text);
}
.header-search input::placeholder { color: var(--tw-text-light); }
.header-search svg { color: var(--tw-text-muted); flex-shrink: 0; }

.header-nav {
  display: flex; align-items: center; gap: clamp(8px, 1.5vw, 22px);
  margin-left: auto;
}
.nav-link {
  font-size: var(--tw-fs-sm); font-weight: 600;
  color: var(--tw-text); white-space: nowrap;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 4px;
  transition: color var(--tw-dur);
}
.nav-link:hover { color: var(--tw-brand); }
.nav-link svg { color: var(--tw-text-muted); }
.nav-link:hover svg { color: var(--tw-brand); }

.btn-outline {
  font-size: var(--tw-fs-sm); font-weight: 700;
  color: var(--tw-brand);
  border: 1.5px solid var(--tw-brand);
  background: transparent;
  padding: 9px 22px;
  border-radius: var(--tw-radius-pill);
  transition: all var(--tw-dur) var(--tw-ease);
  white-space: nowrap;
}
.btn-outline:hover { background: var(--tw-brand); color: #fff; }

.btn-primary {
  font-size: var(--tw-fs-sm); font-weight: 700;
  color: #fff; background: var(--tw-brand);
  padding: 11px 24px;
  border-radius: var(--tw-radius-pill);
  transition: all var(--tw-dur) var(--tw-ease);
  white-space: nowrap;
}
.btn-primary:hover { background: var(--tw-brand-deep); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(27,168,200,0.3); }

@media (max-width:880px) {
  .header-search { display: none; }
  .header-nav { gap: 12px; }
  .nav-link span.label { display: none; }
}

/* === HERO === */
.hero {
  position: relative;
  min-height: clamp(340px, 42vw, 480px);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  margin-bottom: clamp(40px, 5vw, 64px);
}
.hero-bg {
  position: absolute; inset: 0;
  background:
    linear-gradient(135deg, rgba(0,0,0,0.35), rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.45)),
    linear-gradient(45deg, #c8a87a, #a06848, #8f5030, #4a6b4a);
  background-size: cover; background-position: center;
}
.hero-bg::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(circle at 20% 30%, rgba(255,180,100,0.4), transparent 40%),
    radial-gradient(circle at 80% 70%, rgba(60,140,160,0.4), transparent 40%);
}
.hero-content {
  position: relative; z-index: 2;
  text-align: center; color: #fff;
  padding: 32px 24px;
  max-width: 720px; width: 100%;
}
.hero-title {
  font-family: var(--tw-font-display);
  font-size: clamp(2.25rem, 5.5vw, var(--tw-fs-4xl));
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: #fff;
  margin-bottom: 14px;
  text-shadow: 0 2px 16px rgba(0,0,0,0.25);
}
.hero-title .tagline {
  display: block;
  font-size: 0.62em;
  font-weight: 700;
  margin-top: 8px;
  opacity: 0.95;
}
.hero-search {
  margin: 28px auto 0;
  max-width: 540px;
  display: flex; align-items: center;
  background: #fff;
  border-radius: var(--tw-radius-pill);
  padding: 6px 6px 6px 22px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.15);
}
.hero-search input {
  flex: 1; border: 0; background: transparent; outline: none;
  font: inherit; font-size: var(--tw-fs-md);
  color: var(--tw-text); padding: 12px 0;
}
.hero-search input::placeholder { color: var(--tw-text-light); }
.hero-search button {
  width: 48px; height: 48px;
  background: var(--tw-brand);
  border-radius: var(--tw-radius-pill);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  transition: background var(--tw-dur);
  flex-shrink: 0;
}
.hero-search button:hover { background: var(--tw-brand-deep); }

/* === CATEGORY CHIP RAIL (under hero) === */
.cat-rail {
  margin: 0 0 clamp(32px, 4vw, 56px);
  position: relative;
}
.cat-rail-scroll {
  display: flex; gap: 16px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 4px;
  scroll-snap-type: x mandatory;
}
.cat-rail-scroll::-webkit-scrollbar { display: none; }
.cat-chip {
  display: inline-flex; align-items: center; gap: 12px;
  background: #fff;
  border: 1px solid var(--tw-rule);
  border-radius: var(--tw-radius);
  padding: 8px 18px 8px 8px;
  flex-shrink: 0;
  scroll-snap-align: start;
  transition: all var(--tw-dur) var(--tw-ease);
  box-shadow: var(--tw-shadow-sm);
  min-width: 168px;
}
.cat-chip:hover { transform: translateY(-2px); box-shadow: var(--tw-shadow-md); border-color: var(--tw-brand); }
.cat-chip-img {
  width: 48px; height: 48px;
  border-radius: 8px;
  background: var(--tw-rule-soft);
  flex-shrink: 0;
  overflow: hidden;
}
.cat-chip-label {
  font-size: var(--tw-fs-sm); font-weight: 700;
  color: var(--tw-ink);
  line-height: 1.2;
}
.cat-rail-arrow {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  width: 40px; height: 40px;
  background: #fff;
  border: 1px solid var(--tw-rule);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--tw-brand);
  box-shadow: var(--tw-shadow);
  cursor: pointer;
  transition: all var(--tw-dur);
  z-index: 2;
}
.cat-rail-arrow:hover { background: var(--tw-brand); color: #fff; }

/* === SECTION === */
.section { padding: clamp(28px, 4vw, 56px) 0; }
.section--soft { background: var(--tw-bg-soft); }

.section-head {
  display: flex; align-items: end; justify-content: space-between;
  gap: 24px; margin-bottom: clamp(20px, 2.5vw, 32px);
}
.section-head-left { display: flex; flex-direction: column; gap: 4px; }
.section-eyebrow {
  font-size: var(--tw-fs-sm);
  color: var(--tw-text-muted);
}
.section-title {
  font-family: var(--tw-font-display);
  font-size: clamp(1.5rem, 2.6vw, var(--tw-fs-2xl));
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--tw-ink);
}
.section-link {
  color: var(--tw-brand);
  font-size: var(--tw-fs-sm); font-weight: 600;
  white-space: nowrap;
}
.section-link:hover { text-decoration: underline; text-underline-offset: 3px; }

/* === CARD === */
.card {
  background: #fff;
  border-radius: var(--tw-radius);
  overflow: hidden;
  border: 1px solid var(--tw-rule);
  display: flex; flex-direction: column;
  transition: all var(--tw-dur) var(--tw-ease);
  box-shadow: var(--tw-shadow-sm);
}
.card:hover { transform: translateY(-4px); box-shadow: var(--tw-shadow-md); border-color: var(--tw-rule); }
.card-img {
  aspect-ratio: 16/11;
  background: var(--tw-rule-soft);
  position: relative;
  overflow: hidden;
}
.card-img img, .card-img .ph { width: 100%; height: 100%; object-fit: cover; }
.card-pin {
  position: absolute; right: 10px; top: 10px;
  width: 32px; height: 32px;
  background: rgba(255,255,255,0.95);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--tw-brand);
  opacity: 0; transform: translateY(-4px);
  transition: all var(--tw-dur);
}
.card:hover .card-pin { opacity: 1; transform: translateY(0); }
.card-body {
  padding: 16px 18px 14px;
  flex: 1; display: flex; flex-direction: column;
}
.card-title {
  font-family: var(--tw-font-display);
  font-size: var(--tw-fs-md);
  font-weight: 800;
  line-height: 1.32;
  color: var(--tw-ink);
  letter-spacing: -0.01em;
  margin-bottom: 12px;
  text-wrap: balance;
}
.card:hover .card-title { color: var(--tw-brand); }
.card-foot {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--tw-rule-soft);
  display: flex; align-items: center; gap: 10px;
}
.card-avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--tw-brand-soft);
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800; color: var(--tw-brand);
  overflow: hidden;
}
.card-avatar.is-brand {
  background: var(--tw-brand);
  color: #fff;
}
.card-byline {
  font-size: var(--tw-fs-sm);
  color: var(--tw-text-muted);
  font-weight: 600;
}
.card-byline strong { color: var(--tw-ink); font-weight: 700; }

/* === GRID === */
.grid { display: grid; gap: clamp(16px, 2vw, 24px); }
.grid-2 { grid-template-columns: repeat(2, 1fr); }
.grid-3 { grid-template-columns: repeat(3, 1fr); }
.grid-4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width:980px) { .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); } }
@media (max-width:560px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } }

/* === EDITOR'S PICKS (large + stack) === */
.picks-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: clamp(20px, 3vw, 40px);
}
@media (max-width:880px) { .picks-grid { grid-template-columns: 1fr; } }
.picks-hero .card-img { aspect-ratio: 16/10; }
.picks-hero .card-title { font-size: var(--tw-fs-xl); }
.picks-excerpt {
  color: var(--tw-text-muted);
  font-size: var(--tw-fs-md);
  line-height: 1.55;
  margin-bottom: 16px;
}
.picks-stack { display: flex; flex-direction: column; gap: 4px; }

/* === TRENDING (dark section, numbered) === */
.trending-section {
  background: var(--tw-ink);
  color: #fff;
  padding: clamp(40px, 5vw, 64px) 0;
  margin: clamp(32px, 4vw, 48px) 0;
}
.trending-section .section-title { color: #fff; display: inline-flex; align-items: center; gap: 12px; }
.trending-section .section-eyebrow { color: #8a93a3; }
.pulse-dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--tw-brand);
  position: relative;
}
.pulse-dot::after {
  content: ""; position: absolute; inset: -4px;
  border-radius: 50%;
  background: var(--tw-brand);
  opacity: 0.3;
  animation: pulse 1.6s ease-out infinite;
}
@keyframes pulse {
  0% { transform: scale(0.6); opacity: 0.5; }
  100% { transform: scale(1.6); opacity: 0; }
}
.trending-scroll {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 24px;
}
@media (max-width:980px) {
  .trending-scroll { display: flex; overflow-x: auto; gap: 18px; scrollbar-width: none; padding-bottom: 8px; }
  .trending-scroll::-webkit-scrollbar { display: none; }
  .trending-item { min-width: 240px; }
}
.trending-item {
  display: flex; flex-direction: column; gap: 14px;
  padding: 20px 0;
  border-top: 1px solid rgba(255,255,255,0.1);
  transition: opacity var(--tw-dur);
}
.trending-item:hover { opacity: 0.85; }
.trending-num {
  font-family: var(--tw-font-display);
  font-size: 2rem; font-weight: 900;
  color: var(--tw-brand);
  line-height: 1;
}
.trending-img {
  aspect-ratio: 16/10;
  border-radius: var(--tw-radius);
  overflow: hidden;
  background: #2a2f38;
}
.trending-cat {
  font-size: var(--tw-fs-xs);
  color: var(--tw-brand);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: block;
  margin-bottom: 6px;
}
.trending-h {
  font-family: var(--tw-font-display);
  font-size: var(--tw-fs-base);
  font-weight: 800;
  line-height: 1.3;
  color: #fff;
  letter-spacing: -0.01em;
}

/* === TOPIC SPOTLIGHT === */
.spotlight-desc {
  color: var(--tw-text-muted);
  font-size: var(--tw-fs-md);
  line-height: 1.5;
  margin-top: 4px;
  max-width: 56ch;
}

/* === STORY ROW (for picks stack + general use) === */
.story-row {
  display: grid; grid-template-columns: 110px 1fr; gap: 16px;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--tw-rule);
}
.story-row:last-child { border-bottom: 0; }
.story-row .img {
  width: 110px; height: 80px;
  border-radius: 8px;
  background: var(--tw-rule-soft);
  overflow: hidden;
}
.story-row .body h4 {
  font-family: var(--tw-font-display);
  font-size: var(--tw-fs-base);
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.28;
  margin-bottom: 6px;
  color: var(--tw-ink);
}
.story-row:hover h4 { color: var(--tw-brand); }
.story-row .meta {
  font-size: var(--tw-fs-xs);
  color: var(--tw-text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* === FEATURED ROW (large + 2) === */
.featured {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: clamp(16px, 2vw, 24px);
}
.featured > .card:first-child .card-img { aspect-ratio: 16/10; }
.featured > .card:first-child .card-title { font-size: var(--tw-fs-xl); }
@media (max-width:980px) {
  .featured { grid-template-columns: 1fr 1fr; }
  .featured > .card:first-child { grid-column: span 2; }
}
@media (max-width:560px) {
  .featured { grid-template-columns: 1fr; }
  .featured > .card:first-child { grid-column: auto; }
}

/* === NEWSLETTER === */
.newsletter {
  background: linear-gradient(135deg, var(--tw-brand-tint), #fff);
  border: 1px solid var(--tw-brand-soft);
  border-radius: var(--tw-radius-lg);
  padding: clamp(28px, 4vw, 56px);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(24px, 4vw, 56px);
  align-items: center;
  margin: clamp(32px, 4vw, 56px) 0;
}
@media (max-width:760px) { .newsletter { grid-template-columns: 1fr; } }
.newsletter h2 {
  font-size: clamp(1.5rem, 2.8vw, 2rem);
  font-weight: 800;
  line-height: 1.1;
  color: var(--tw-ink);
  margin-bottom: 12px;
}
.newsletter p { color: var(--tw-text-muted); font-size: var(--tw-fs-md); }
.newsletter-form {
  display: flex; gap: 8px;
  background: #fff;
  border: 1px solid var(--tw-rule);
  border-radius: var(--tw-radius-pill);
  padding: 6px 6px 6px 22px;
  align-items: center;
}
.newsletter-form input {
  flex: 1; border: 0; background: transparent; outline: none;
  font: inherit; font-size: var(--tw-fs-sm);
  padding: 12px 0;
}
/* RESCUE-4: server-render newsletter form uses BEM-ish hooks (renderNewsletter);
   map them onto the design newsletter look + keep the disabled-state + sr-label. */
.newsletter__heading { font-family: var(--tw-font-display); font-size: clamp(1.5rem, 2.8vw, 2rem); font-weight: 800; line-height: 1.1; color: var(--tw-ink); margin: 0 0 12px; }
.newsletter__description { color: var(--tw-text-muted); font-size: var(--tw-fs-md); margin: 0; }
.newsletter__form {
  display: flex; gap: 8px;
  background: #fff;
  border: 1px solid var(--tw-rule);
  border-radius: var(--tw-radius-pill);
  padding: 6px 6px 6px 22px;
  align-items: center;
}
.newsletter__input { flex: 1; border: 0; background: transparent; outline: none; font: inherit; font-size: var(--tw-fs-sm); padding: 12px 0; }
.newsletter__cta { font-size: var(--tw-fs-sm); font-weight: 700; color: #fff; background: var(--tw-brand); padding: 11px 24px; border-radius: var(--tw-radius-pill); transition: all var(--tw-dur) var(--tw-ease); white-space: nowrap; }
.newsletter__cta:hover { background: var(--tw-brand-deep); }
.newsletter__cta[aria-disabled="true"], .newsletter__input[aria-disabled="true"] { background: var(--tw-text-light); cursor: not-allowed; }
.newsletter__notice { margin: 0.75rem 0 0; color: var(--tw-text-muted); font-size: var(--tw-fs-sm); }
.newsletter-label-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }

/* === AD SLOT === */
.ad-slot {
  display: flex; align-items: center; justify-content: center;
  background: var(--tw-bg-soft);
  border: 1px dashed var(--tw-rule);
  border-radius: var(--tw-radius);
  color: var(--tw-text-light);
  font-size: var(--tw-fs-xs);
  text-transform: uppercase; letter-spacing: 0.1em;
  margin: clamp(24px, 3vw, 40px) auto;
  font-weight: 700;
}
.ad-slot::before {
  content: "Sponsored"; margin-right: 8px; color: var(--tw-text-muted);
}
.ad-slot--leaderboard { width: 100%; max-width: 970px; height: 90px; }
.ad-slot--in-feed { width: 100%; max-width: 728px; height: 90px; }
/* RESCUE-4 anti-CLS: renderAdSlot also stamps data-ad-type; reserve the box per
   type so a deferred stylesheet never collapses it. Height-only (never a fixed
   pixel WIDTH — 970px overflowed the 375px mobile viewport). */
.ad-slot[data-ad-type="leaderboard"] { min-height: 90px; max-width: 970px; }
.ad-slot[data-ad-type="in-feed"]    { min-height: 90px; max-width: 728px; }
.ad-slot[data-ad-type="rect"]       { min-height: 250px; max-width: 300px; }

/* === FOOTER === */
.site-footer {
  background: var(--tw-ink);
  color: #c8cfd9;
  padding: clamp(48px, 5vw, 72px) 0 28px;
  margin-top: clamp(48px, 6vw, 80px);
}
.footer-top {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: clamp(24px, 3vw, 48px);
  padding-bottom: 40px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
@media (max-width:800px) { .footer-top { grid-template-columns: 1fr 1fr; } }
@media (max-width:480px) { .footer-top { grid-template-columns: 1fr; } }
.footer-brand .brand-name { color: #fff; }
.footer-brand p { font-size: var(--tw-fs-sm); margin-top: 14px; max-width: 38ch; line-height: 1.55; color: #8a93a3; }
.footer-col h4 {
  font-size: var(--tw-fs-sm); font-weight: 800;
  color: #fff; margin-bottom: 14px;
  letter-spacing: -0.01em;
}
.footer-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.footer-col a { font-size: var(--tw-fs-sm); color: #8a93a3; transition: color var(--tw-dur); }
.footer-col a:hover { color: var(--tw-brand); }
.footer-bottom {
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;
  padding-top: 24px;
  font-size: var(--tw-fs-xs); color: #5a6270;
}
.footer-social { display: flex; gap: 10px; }
.footer-social a {
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.15);
  display: inline-flex; align-items: center; justify-content: center;
  color: #c8cfd9;
  transition: all var(--tw-dur);
}
.footer-social a:hover { background: var(--tw-brand); color: #fff; border-color: var(--tw-brand); }
/* RESCUE-4: operator-set social links render with the .site-footer__social hook
   (buildSocialLinks); style them as the design footer-social pills. */
.site-footer__social { display: flex; gap: 10px; list-style: none; margin: 0; padding: 0; }
.site-footer__social-link { color: #c8cfd9; text-decoration: none; }
.site-footer__social-link:hover { color: #fff; text-decoration: underline; }

/* === FLOATING NEXT-PAGE BUTTON === */
.floating-next {
  position: fixed; right: 24px; top: 50%; transform: translateY(-50%);
  width: 64px; height: 64px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid var(--tw-rule);
  box-shadow: var(--tw-shadow-md);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--tw-brand);
  z-index: 30;
  transition: all var(--tw-dur);
}
.floating-next:hover { background: var(--tw-brand); color: #fff; transform: translateY(-50%) scale(1.06); }
.floating-next .lbl {
  font-size: 9px; font-weight: 700;
  letter-spacing: 0.05em;
  margin-top: 2px;
}
@media (max-width:1280px) { .floating-next { display: none; } }

/* === RECOMMENDS BADGE (brand-house byline) === */
.recommends-mark {
  width: 28px; height: 28px;
  background: var(--tw-brand);
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  flex-shrink: 0;
}

/* === .ph IMAGE FILL (design Ph component) === */
.ph {
  background:
    linear-gradient(135deg, transparent 0 49%, rgba(255,255,255,0.18) 49% 51%, transparent 51% 100%) 0 0/14px 14px,
    linear-gradient(45deg, var(--ph-a, #c8d8e8), var(--ph-b, #1ba8c8));
  position: relative;
  width: 100%; height: 100%;
}
.ph::after {
  content: attr(data-label);
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  color: rgba(255,255,255,0.95);
  letter-spacing: 0.04em; padding: 8px; text-align: center;
  text-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

/* ============================================================
   RETAINED ARTICLE-PAGE CSS — the design styles.css does not carry these.
   (Article page DOM is unchanged by the home re-skin.)
   ============================================================ */
.home-grid { list-style: none; margin: 0; padding: 0; }
.home-grid__item { display: flex; }
.home-grid__item > .card { width: 100%; }
.section-empty { color: var(--tw-text-muted); font-size: var(--tw-fs-sm); }
.page-title, .category-title { font-family: var(--tw-font-display); font-size: var(--tw-fs-3xl); color: var(--tw-ink); margin: 0 0 1rem; }

.reading-progress { position: fixed; top: 0; left: 0; right: 0; height: 3px; background: transparent; z-index: 60; }
.reading-progress-bar { height: 100%; width: 100%; background: var(--tw-brand); transform: scaleX(0); transform-origin: left center; transition: transform 80ms linear; }

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
.article-shell { display: grid; grid-template-columns: 60px minmax(0, 1fr) 320px; gap: clamp(24px, 4vw, 56px); align-items: start; padding: 2rem 0; }
.share-rail { position: sticky; top: calc(var(--tw-header-h) + 1rem); display: flex; flex-direction: column; gap: 0.5rem; }
.share-btn { width: 40px; height: 40px; border-radius: var(--tw-radius-pill); border: 1px solid var(--tw-rule); background: var(--tw-bg); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.share-btn[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
.share-count { font-size: var(--tw-fs-xs); color: var(--tw-text-muted); text-align: center; }

/* Contract section 2 pins article body copy at 1.125rem/1.7 and article H2 at
   1.75rem/1.2 weight 800 — literal values, NOT the fs tokens (fs-md is 17px). */
.article-body { font-size: 1.125rem; line-height: 1.7; color: var(--tw-text); }
.article-body p { margin: 0 0 1.25em; }
/* Contract section 11: drop cap on the lede paragraph — 4.2em display weight 900
   brand colour. Scoped to the first top-level <p> so only the opening paragraph
   gets it (body blocks render as direct .article-body children). */
.article-body > p:first-of-type::first-letter { float: left; font-family: var(--tw-font-display); font-size: 4.2em; font-weight: 900; line-height: 0.78; color: var(--tw-brand); padding-right: 0.08em; margin-top: 0.04em; }
.article-body h2 { font-family: var(--tw-font-display); font-size: 1.75rem; line-height: 1.2; font-weight: 800; color: var(--tw-ink); margin: 2em 0 0.5em; }
/* Contract section 11: ul bullets are a 16x2px brand dash, li padding-left 28px. */
.article-body ul { padding-left: 0; list-style: none; }
.article-body ul > li { position: relative; padding-left: 28px; margin: 0 0 0.5em; }
.article-body ul > li::before { content: ""; position: absolute; left: 0; top: 0.7em; width: 16px; height: 2px; background: var(--tw-brand); border-radius: var(--tw-radius-sm); }
.article-body ol { padding-left: 1.25em; }
.sponsor-disclosure { font-size: var(--tw-fs-xs); color: var(--tw-text-muted); border-left: 3px solid var(--tw-accent); padding: 0.25em 0.75em; margin: 0 0 1em; }
.pullquote { font-family: var(--tw-font-display); font-size: var(--tw-fs-xl); color: var(--tw-ink); border-left: 4px solid var(--tw-brand); padding: 0.5em 1em; margin: 1.5em 0; }
.article-figure { margin: 1.5em 0; }
.article-figure img { border-radius: var(--tw-radius); }
.article-figure figcaption { color: var(--tw-text-muted); font-size: var(--tw-fs-sm); margin-top: 0.5em; }
.callout-box { background: var(--tw-bg-tint); border-radius: var(--tw-radius); padding: 1em 1.25em; margin: 1.5em 0; }
.callout-box .callout-title { display: block; font-family: var(--tw-font-display); font-weight: 800; color: var(--tw-ink); margin-bottom: 0.25em; }
.callout-box p:last-child { margin-bottom: 0; }
.affiliate-card { background: var(--tw-bg); border: 1px solid var(--tw-rule); border-radius: var(--tw-radius-lg); padding: 1em; margin: 1.5em 0; box-shadow: var(--tw-shadow-sm); }
.affiliate-card .affiliate-card-title { display: block; font-family: var(--tw-font-display); font-weight: 800; color: var(--tw-ink); }
.affiliate-card .affiliate-card-desc { color: var(--tw-text-muted); margin: 0.25em 0 0.75em; }
.affiliate-card .affiliate-card-cta { display: inline-block; background: var(--tw-brand); color: #fff; border-radius: var(--tw-radius-pill); padding: 9px 22px; font-weight: 700; font-size: var(--tw-fs-sm); }
.affiliate-card .affiliate-card-cta:hover { background: var(--tw-brand-deep); text-decoration: none; }

.faq-section { padding: 2rem 0; }
.faq-section details { border-top: 1px solid var(--tw-rule); padding: 0.75rem 0; }
.faq-section summary { font-weight: 600; cursor: pointer; }

.article-share-bottom { display: flex; gap: 0.5rem; padding: 1rem 0; border-top: 1px solid var(--tw-rule); }

.article-sidebar { display: flex; flex-direction: column; gap: 1.25rem; }
.sidebar-card { background: var(--tw-bg); border: 1px solid var(--tw-rule); border-radius: var(--tw-radius); padding: 1rem; }
.toc ol { padding-left: 1.25em; margin: 0.25em 0 0; }
.sidebar-newsletter input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid var(--tw-rule); border-radius: var(--tw-radius); }
.sidebar-ad { padding: 0; background: transparent; border: 0; }
.sidebar-popular ol { padding-left: 0; margin: 0; list-style: none; }
.pop-item { padding: 0.5rem 0; border-top: 1px solid var(--tw-rule-soft); }
.pop-item:first-child { border-top: 0; padding-top: 0; }
.pop-item a { display: flex; align-items: center; gap: 0.625rem; color: inherit; text-decoration: none; }
.pop-img { width: 60px; height: 60px; flex: 0 0 60px; object-fit: cover; border-radius: var(--tw-radius-sm); background: var(--tw-bg-tint); }
.pop-title { font-size: var(--tw-fs-sm); line-height: 1.3; }

.related-section { padding: 2.5rem 0; }

/* === RETAINED ARTICLE breakpoint slices (the design home breakpoints are
   inlined beside their components above). === */
@media (max-width:1080px) {
  .article-shell { grid-template-columns: minmax(0, 1fr) 300px; }
  .share-rail { display: none !important; }
}
@media (max-width:800px) {
  .article-shell { grid-template-columns: 1fr; }
  .article-sidebar { order: 2; }
}
`;

export default publicCss;
