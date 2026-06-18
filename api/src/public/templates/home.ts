// Phase 5 / T11: renderHome composes the public Home body in the decoded
// design-contract order (docs/design-contract.md §7).
//
// §7 divides the Home page into 13 ordered sections; the exact set and
// sequence are a 100% contract (BCL-002). Each section is delimited by an
// `<!-- home-section:N name -->` comment so the section-order behavioural
// test can assert the exact marker sequence without depending on CSS class
// names.
//
// Section catalogue (numerical = render order, contract §7):
//   1  site-header     renderHeader       (banner + brand wordmark + nav)
//   2  hero            renderHero         (top story: title/excerpt/image)
//   3  chip-rail       renderChipRail     (taxonomy chips → /category/<slug>)
//   4  featured        renderCard×3       (featured stories, first enlarged)
//   5  ad-leaderboard  renderAdSlot       (leaderboard surface, 970×90)
//   6  editors-picks   renderCard×4       (curated re-promotion of featured)
//   7  trending        renderTrending     (dark strip, vm.trending top 5)
//   8  spotlight       (real /category/<slug> links per category)
//   9  ad-in-feed      renderAdSlot       (in-feed surface, 728×90)
//   10 latest          renderCard×N       (remaining latest cards)
//   11 newsletter      renderNewsletter   (provider-aware disabled state)
//   12 site-footer     renderFooter       (legal + nav + copyright)
//   13 floating-next   renderFloatingNext (fixed circle, hidden < 1280px)
//
// Contract §7: the Home page has NO standalone site-description panel —
// §12 is the footer and §13 the floating "Read next" button.
//
// PART 12 RED LINE: every visible brand string flows from vm.site.{name,
// tagline} or per-card data — this module MUST NOT hardcode TheIWise /
// cms.kodigital.app. The no-brand regression test exercises renderHome to
// assert this.
//
// PART 8 RED LINE: every href is a real URL (chip = /category/<slug>,
// card = /article/<slug>, footer/nav are caller-supplied). No href="#".

import type { HomeArticleCard, HomeViewModel } from "../view-models/home";
import {
  renderAdSlot,
  renderCard,
  renderChipRail,
  renderFloatingNext,
  renderFooter,
  renderHeader,
  renderHero,
  renderNewsletter,
  type CategoryChip,
  type NavLink,
} from "./components";
import { renderTrending } from "./trending";

export interface RenderHomeArgs {
  vm: HomeViewModel;
  nav?: ReadonlyArray<NavLink>;
  footerLinks?: ReadonlyArray<NavLink>;
  legalLinks?: ReadonlyArray<NavLink>;
}

function escAttr(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escText(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function marker(n: number, name: string): string {
  return `<!-- home-section:${n} ${name} -->`;
}

function cardFromVm(c: HomeArticleCard): string {
  return renderCard({
    href: c.href,
    title: c.title,
    excerpt: c.excerpt,
    imageUrl: c.imageUrl,
    imageAlt: c.imageAlt,
    publishedAt: c.publishedAt,
    categoryName: c.categoryName,
    readMinutes: c.readMinutes,
  });
}

function gridSection(
  heading: string,
  modifier: string,
  cards: ReadonlyArray<HomeArticleCard>,
  emptyLabel: string,
): string {
  if (cards.length === 0) {
    return `<div class="section-head"><h2>${escText(heading)}</h2></div><p class="section-empty">${escText(emptyLabel)}</p>`;
  }
  const items = cards.map((c) => `<li class="home-grid__item">${cardFromVm(c)}</li>`).join("");
  return `<div class="section-head"><h2>${escText(heading)}</h2></div><ul class="home-grid home-grid--${modifier}">${items}</ul>`;
}

export function renderHome(args: RenderHomeArgs): string {
  const vm = args.vm;
  const site = vm.site;

  // §1 — site-header
  const s1 = renderHeader({
    site: {
      name: site.name,
      tagline: site.tagline,
      logoUrl: site.logoUrl,
      hostname: site.hostname,
    },
    nav: args.nav,
  });

  // §2 — hero (sourced from vm.hero; fall back to a site-name hero when
  // the tenant has no published articles yet so the hero slot is never
  // collapsed and the section count remains 13). Both branches go through
  // renderHero so the §11 contract DOM (.hero-bg + .hero-content >
  // h1.hero-title > span.tagline + form.hero-search) holds either way.
  //
  // T18 (BCL-056): the full-bleed .hero-bg image is the operator-set
  // site-level hero image (vm.heroImageUrl, already /media/<key>) when one is
  // configured — it fills the banner behind the title + search regardless of
  // which article leads. When unset it falls back to the lead article's
  // featured image, and when there are no articles the site hero still paints
  // the banner (the previous behaviour rendered an imageless hero).
  const hero = vm.hero;
  const siteHeroImageUrl = vm.heroImageUrl ?? null;
  const s2 = hero !== null
    ? renderHero({
        title: hero.title,
        excerpt: hero.excerpt,
        imageUrl: siteHeroImageUrl ?? hero.imageUrl,
        imageAlt: hero.imageAlt,
        href: hero.href,
        kicker: hero.categoryName.length > 0 ? hero.categoryName : undefined,
      })
    : renderHero({
        title: site.name,
        excerpt: site.tagline.length > 0 ? site.tagline : undefined,
        imageUrl: siteHeroImageUrl,
      });

  // §3 — chip-rail (categories)
  const chips: CategoryChip[] = vm.categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    href: c.href,
  }));
  const s3 = renderChipRail({ chips, label: "Browse by topic" });

  // §4 — featured grid (up to 3 cards, first enlarged by CSS)
  const featured = vm.featured.slice(0, 3);
  const s4 = gridSection("Featured", "featured", featured, "No featured stories yet.");

  // §5 — ad slot, leaderboard surface
  const s5 = renderAdSlot({ type: "leaderboard", slotId: "home-leaderboard", surface: "home" });

  // §6 — editor's picks (re-promote up to 4 featured for the picks rail)
  const picks = vm.featured.slice(0, 4);
  const s6 = gridSection("Editor's picks", "picks", picks, "Editor's picks coming soon.");

  // §7 — trending (vm.trending bucket = is_trending rows, contract: 5 items;
  // dark full-bleed strip, .trending-section root, ranked 01..05 numerals)
  const s7 = renderTrending({
    items: vm.trending.slice(0, 5).map((c) => ({
      href: c.href,
      title: c.title,
      imageUrl: c.imageUrl,
      imageAlt: c.imageAlt,
      categoryName: c.categoryName,
    })),
  });

  // §8 — category spotlight (each category linked, PART 8 real URLs)
  const s8 = vm.categories.length > 0
    ? `<div class="section-head"><h2>Explore by category</h2></div><ul class="home-categories">${vm.categories
        .map(
          (c) =>
            `<li class="home-categories__item"><a class="home-categories__link" href="${escAttr(c.href)}">${escText(c.name)}</a></li>`,
        )
        .join("")}</ul>`
    : `<p class="section-empty">Categories will appear here.</p>`;

  // §9 — ad slot, in-feed surface
  const s9 = renderAdSlot({ type: "in-feed", slotId: "home-in-feed", surface: "home" });

  // §10 — latest. T16/BCL-057: render EVERY non-featured article. vm.latest
  // is already the deduplicated tail — buildHomeViewModel removes the
  // is_trending rows from the pool and excludes hero + featured by id before
  // cutting `latest` — so the §7 trending strip and §10 latest grid share no
  // article. The previous `vm.latest.slice(5)` silently dropped the first 5
  // non-featured articles (a false "remaining after trending" assumption:
  // trending is a separate is_trending bucket, never the head of vm.latest),
  // so those stories appeared in NO home section. Render the full bucket.
  const latest = vm.latest;
  const s10 = gridSection("Latest", "latest", latest, "More stories on the way.");

  // §11 — newsletter
  const s11 = renderNewsletter({
    heading: vm.newsletter.heading,
    description: vm.newsletter.description,
    provider: vm.newsletter.provider,
  });

  // §12 — site-footer
  const s12 = renderFooter({
    site: {
      name: site.name,
      hostname: site.hostname,
      tagline: site.tagline,
      logoUrl: site.logoUrl,
    },
    links: args.footerLinks,
    legalLinks: args.legalLinks,
  });

  // §13 — floating "Read next" button (contract §11: fixed 64×64 circle,
  // hidden < 1280px by CSS). Target = the lead story; PART 8: real article
  // URL, never "#". When the tenant has no published stories the aside is
  // omitted but the marker still renders so the section count stays 13.
  const next = vm.hero ?? vm.featured[0] ?? vm.latest[0] ?? null;
  const s13 = next !== null && next !== undefined
    ? renderFloatingNext({
        href: next.href,
        label: next.title,
        imageUrl: next.imageUrl,
        imageAlt: next.imageAlt,
      })
    : "";

  const sections = [
    `${marker(1, "site-header")}\n${s1}`,
    `${marker(2, "hero")}\n${s2}`,
    `${marker(3, "chip-rail")}\n${s3.length > 0 ? `<div class="container">${s3}</div>` : ""}`,
    `${marker(4, "featured")}\n<section class="home-section home-section--featured">${s4}</section>`,
    `${marker(5, "ad-leaderboard")}\n${s5}`,
    `${marker(6, "editors-picks")}\n<section class="home-section home-section--picks" id="picks">${s6}</section>`,
    `${marker(7, "trending")}\n<section class="home-section home-section--trending trending-section" id="trending">${s7}</section>`,
    `${marker(8, "spotlight")}\n<section class="home-section home-section--spotlight">${s8}</section>`,
    `${marker(9, "ad-in-feed")}\n${s9}`,
    `${marker(10, "latest")}\n<section class="home-section home-section--latest">${s10}</section>`,
    `${marker(11, "newsletter")}\n${s11}`,
    `${marker(12, "site-footer")}\n${s12}`,
    `${marker(13, "floating-next")}\n${s13}`,
  ].join("\n");

  // C4 root wrapper: data-screen-label names the decoded design-export
  // screen. The attribute value is deliberately UNQUOTED — the T9.AC2
  // contract grep matches the literal `data-screen-label=theiwise-home`
  // (no quote between `=` and the value); quoting it breaks the contract.
  // The no-brand regression strips data-screen-label attributes before its
  // banned-token sweep, so this label never trips the /theiwise/i ban.
  return `<div data-screen-label=theiwise-home>\n${sections}\n</div>`;
}
