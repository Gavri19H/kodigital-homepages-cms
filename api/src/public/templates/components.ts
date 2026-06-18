// Phase 5 / T4: site-aware component primitives for Home + Article.
// Every visible brand string is sourced from the view-model (site.name /
// site.tagline / category.name / article.title …). PART 12 RED LINE: this
// module MUST NOT hard-code any vertical brand identity, and PART 8
// forbids placeholder anchor hrefs — every link uses a real URL
// (category slug, article slug, page slug).
//
// Section ownership inside the 13-section Home + 12-section Article:
//   renderHeader      — Home §1, Article §1
//   renderHero        — Home §2, Article §3 (hero/title)
//   renderChipRail    — Home §3 (taxonomy chips)
//   renderCard        — Home §4..§8 (featured grid + lists) and Article §11 (related)
//   renderNewsletter  — Home §11, Article §10
//   renderFooter      — Home §13, Article §12
//   renderAdSlot      — Home §6/§9 + Article §6/§9 (leaderboard | in-feed | rect)
//   renderFloatingNext— Article §12 (>=1280px viewport only, PART 4)

import { escAttr, escText, imgTag } from "./esc";
import { iconBrandMark, iconChevronDown, iconSearch } from "./icons";
import { responsiveImg } from "./responsive-img";

export interface SiteRef {
  name: string;
  tagline?: string;
  logoUrl?: string | null;
  hostname?: string;
}

export interface NavLink {
  label: string;
  href: string;
  active?: boolean;
}

export interface CategoryChip {
  slug: string;
  name: string;
  // Optional pre-built href; when omitted the link is derived from the slug
  // as `/category/${slug}` — PART 8 RED LINE forbids href="#".
  href?: string;
  // Optional 24×24 chip avatar (`.cat-chip-img`); omitted = label-only chip.
  imageUrl?: string | null;
  imageAlt?: string | null;
}

export interface HeaderArgs {
  site: SiteRef;
  nav?: ReadonlyArray<NavLink>;
  searchPlaceholder?: string;
}

export interface HeroArgs {
  title: string;
  excerpt?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  href?: string;
  kicker?: string;
  searchPlaceholder?: string;
}

export interface ChipRailArgs {
  chips: ReadonlyArray<CategoryChip>;
  label?: string;
}

export interface CardArgs {
  href: string;
  title: string;
  excerpt?: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  publishedAt?: string;
  categoryName?: string;
  readMinutes?: number | null;
}

export interface NewsletterArgs {
  heading: string;
  description?: string;
  formAction?: string;
  // When provider is null/empty the form renders in a disabled-with-notice
  // state (PART 1 §11 requires the section to exist; PART 11 forbids a live
  // submit when no provider is configured).
  provider?: string | null;
  ctaLabel?: string;
}

export interface FooterArgs {
  site: SiteRef;
  links?: ReadonlyArray<NavLink>;
  legalLinks?: ReadonlyArray<NavLink>;
  copyrightYear?: number;
}

export interface AdSlotArgs {
  type: "leaderboard" | "in-feed" | "rect";
  slotId: string;
  surface?: string;
}

export interface FloatingNextArgs {
  href: string;
  label: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

// Contract §11 header nav: labels + order pinned by docs/design-contract.md
// ("Explore w/ chevron, Trending, Editor's Picks, Newsletter, then
// .btn-outline Sign in"). Fragment hrefs target real Home §6/§7/§11 section
// ids — PART 8 forbids only the bare placeholder href="#".
const CONTRACT_NAV: ReadonlyArray<NavLink> = [
  { label: "Explore", href: "/" },
  { label: "Trending", href: "/#trending" },
  { label: "Editor's Picks", href: "/#picks" },
  { label: "Newsletter", href: "/#newsletter" },
];

function searchPlaceholderOf(input: string | undefined): string {
  return input !== undefined && input.length > 0 ? input : "Search";
}

export function renderHeader(args: HeaderArgs): string {
  const site = args.site;
  const placeholder = searchPlaceholderOf(args.searchPlaceholder);
  const logoHtml =
    site.logoUrl !== undefined && site.logoUrl !== null && site.logoUrl.length > 0
      ? `<img class="brand-logo" src="${escAttr(site.logoUrl)}" alt="" width="38" height="38" loading="eager" decoding="async">`
      : `<span class="brand-logo" aria-hidden="true">${iconBrandMark()}</span>`;
  // Contract §11 child order: .brand → .header-search → .header-nav
  // (4 nav-links, the first with chevron, then .btn-outline "Sign in").
  const nav = args.nav !== undefined && args.nav.length > 0 ? args.nav : CONTRACT_NAV;
  const navLinks = nav
    .map((n, i) => {
      const current = n.active === true ? ' aria-current="page"' : "";
      const chevron = i === 0 ? iconChevronDown({ className: "nav-chevron", size: 12 }) : "";
      return `<a class="nav-link" href="${escAttr(n.href)}"${current}>${escText(n.label)}${chevron}</a>`;
    })
    .join("");
  return `<header class="site-header" role="banner">
  <div class="container">
    <a class="brand" href="/" aria-label="${escAttr(site.name)} home">${logoHtml}<span class="brand-name">${escText(site.name)}</span></a>
    <div class="header-search" role="search"><input type="search" name="q" aria-label="Search" placeholder="${escAttr(placeholder)}"></div>
    <nav class="header-nav" aria-label="Primary">${navLinks}<button class="btn-outline" type="button">Sign in</button></nav>
  </div>
</header>`;
}

export function renderHero(args: HeroArgs): string {
  const href = args.href !== undefined && args.href.length > 0 ? args.href : "";
  const placeholder = searchPlaceholderOf(args.searchPlaceholder);
  const kickerHtml =
    args.kicker !== undefined && args.kicker.length > 0
      ? `<p class="hero-kicker">${escText(args.kicker)}</p>`
      : "";
  // Contract §11 hero DOM: .hero > .hero-bg + .hero-content > h1.hero-title
  // > span.tagline, then form.hero-search. The tagline rides INSIDE the h1.
  const taglineHtml =
    args.excerpt !== undefined && args.excerpt.length > 0
      ? ` <span class="tagline">${escText(args.excerpt)}</span>`
      : "";
  const img = imgTag(args.imageUrl, args.imageAlt, ' width="1200" height="630" loading="eager" fetchpriority="high" decoding="async"');
  const titleText =
    href.length > 0
      ? `<a href="${escAttr(href)}">${escText(args.title)}</a>`
      : escText(args.title);
  return `<section class="hero" aria-label="Featured story">
  <div class="hero-bg" aria-hidden="true">${img}</div>
  <div class="hero-content">
    ${kickerHtml}
    <h1 class="hero-title">${titleText}${taglineHtml}</h1>
    <form class="hero-search" role="search" method="get" action="/">
      <input type="search" name="q" aria-label="Search" placeholder="${escAttr(placeholder)}">
      <button type="submit" aria-label="Search">${iconSearch()}</button>
    </form>
  </div>
</section>`;
}

export function renderChipRail(args: ChipRailArgs): string {
  const chips = args.chips ?? [];
  if (chips.length === 0) return "";
  const label = args.label !== undefined && args.label.length > 0 ? args.label : "Browse by topic";
  const items = chips
    .map((chip) => {
      const slug = String(chip.slug ?? "").trim();
      const name = chip.name !== undefined && chip.name.length > 0 ? chip.name : slug;
      // PART 8 RED LINE: no href="#" placeholder. Derive from slug when the
      // caller does not pre-build the href.
      const href =
        chip.href !== undefined && chip.href.length > 0 ? chip.href : `/category/${slug}`;
      const img = imgTag(
        chip.imageUrl,
        chip.imageAlt ?? name,
        ' class="cat-chip-img" width="24" height="24" loading="lazy" decoding="async"',
      );
      return `<a class="cat-chip" href="${escAttr(href)}">${img}<span class="cat-chip-label">${escText(name)}</span></a>`;
    })
    .join("");
  // Contract §10 vocabulary: chips are DIRECT flex children of `.cat-rail`
  // (scroll-snap container) — no intermediate list element.
  return `<nav class="cat-rail" aria-label="${escAttr(label)}">${items}</nav>`;
}

export function renderCard(args: CardArgs): string {
  const href = args.href.length > 0 ? args.href : "";
  // Contract §11: card image is the 16/10 treatment (640×400). Responsive:
  // srcset + blur-up LQIP + /media/ src (T21). Below-fold → loading="lazy".
  const img = responsiveImg({
    src: args.imageUrl,
    alt: args.imageAlt,
    width: 640,
    height: 400,
    className: "card-img",
    loading: "lazy",
    sizes: "(max-width: 560px) 100vw, (max-width: 1080px) 50vw, 25vw",
  });
  const categoryHtml =
    args.categoryName !== undefined && args.categoryName.length > 0
      ? `<p class="card-cat">${escText(args.categoryName)}</p>`
      : "";
  const metaParts: string[] = [];
  if (args.publishedAt !== undefined && args.publishedAt.length > 0) {
    metaParts.push(`<time class="card-date">${escText(args.publishedAt)}</time>`);
  }
  if (args.readMinutes !== undefined && args.readMinutes !== null) {
    metaParts.push(`<span class="card-read">${escText(String(args.readMinutes))} min read</span>`);
  }
  const metaHtml = metaParts.length > 0 ? `<p class="card-foot">${metaParts.join("")}</p>` : "";
  const excerptHtml =
    args.excerpt !== undefined && args.excerpt.length > 0
      ? `<p class="card-excerpt">${escText(args.excerpt)}</p>`
      : "";
  return `<article class="card">
  <a href="${escAttr(href)}">
    ${img}
    ${categoryHtml}
    <h3 class="card-title">${escText(args.title)}</h3>
    ${excerptHtml}
    ${metaHtml}
  </a>
</article>`;
}

export function renderNewsletter(args: NewsletterArgs): string {
  const action =
    args.formAction !== undefined && args.formAction.length > 0
      ? args.formAction
      : "/api/newsletter/subscribe";
  const ctaLabel = args.ctaLabel !== undefined && args.ctaLabel.length > 0 ? args.ctaLabel : "Subscribe";
  const descriptionHtml =
    args.description !== undefined && args.description.length > 0
      ? `<p class="newsletter__description">${escText(args.description)}</p>`
      : "";
  const disabled = args.provider === null || args.provider === undefined || args.provider.length === 0;
  const disabledAttr = disabled ? ' disabled aria-disabled="true"' : "";
  const noticeHtml = disabled
    ? `<p class="newsletter__notice" role="status">Newsletter signup will open soon.</p>`
    : "";
  return `<section class="newsletter" id="newsletter" aria-labelledby="newsletter-heading">
  <h2 id="newsletter-heading" class="newsletter__heading">${escText(args.heading)}</h2>
  ${descriptionHtml}
  <form class="newsletter__form" method="post" action="${escAttr(action)}">
    <label class="newsletter__label visually-hidden" for="newsletter-email">Email address</label>
    <input class="newsletter__input" id="newsletter-email" name="email" type="email" autocomplete="email" required${disabledAttr}>
    <button class="newsletter__cta" type="submit"${disabledAttr}>${escText(ctaLabel)}</button>
  </form>
  ${noticeHtml}
</section>`;
}

export function renderFooter(args: FooterArgs): string {
  const site = args.site;
  const year = args.copyrightYear ?? new Date().getUTCFullYear();
  const links = args.links ?? [];
  const legalLinks = args.legalLinks ?? [];
  const primaryNavHtml =
    links.length === 0
      ? ""
      : `<nav class="site-footer__nav" aria-label="Footer"><ul>${links
          .map((n) => `<li><a href="${escAttr(n.href)}">${escText(n.label)}</a></li>`)
          .join("")}</ul></nav>`;
  const legalNavHtml =
    legalLinks.length === 0
      ? ""
      : `<nav class="site-footer__legal" aria-label="Legal"><ul>${legalLinks
          .map((n) => `<li><a href="${escAttr(n.href)}">${escText(n.label)}</a></li>`)
          .join("")}</ul></nav>`;
  return `<footer class="site-footer" role="contentinfo">
  <div class="site-footer__inner">
    <p class="site-footer__brand">${escText(site.name)}</p>
    ${primaryNavHtml}
    ${legalNavHtml}
    <p class="site-footer__copyright">&copy; ${year} ${escText(site.name)}</p>
  </div>
</footer>`;
}

export function renderAdSlot(args: AdSlotArgs): string {
  const slotId = escAttr(args.slotId);
  const adType = escAttr(args.type);
  const surfaceAttr =
    args.surface !== undefined && args.surface.length > 0
      ? ` data-ad-surface="${escAttr(args.surface)}"`
      : "";
  return `<aside class="ad-slot ad-slot--${adType}" data-ad-slot="${slotId}" data-ad-type="${adType}"${surfaceAttr} aria-label="Advertisement"></aside>`;
}

export function renderFloatingNext(args: FloatingNextArgs): string {
  const img = imgTag(args.imageUrl, args.imageAlt, ' width="80" height="80" loading="lazy" decoding="async"');
  return `<aside class="floating-next" aria-label="Read next">
  <a class="floating-next__link" href="${escAttr(args.href)}">
    ${img}
    <span class="floating-next__label">${escText(args.label)}</span>
  </a>
</aside>`;
}
