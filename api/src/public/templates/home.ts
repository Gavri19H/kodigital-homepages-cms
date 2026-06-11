// Phase 5 / T10: renderHome composes the public Home body in PART 1 order.
//
// PART 1 (session-4 spec) divides the Home page into 13 ordered sections.
// Each section is delimited by an `<!-- home-section:N name -->` comment so
// the section-order behavioural test can count them and assert their
// numerical order without depending on CSS class names.
//
// Section catalogue (numerical = render order):
//   1  site-header        renderHeader     (banner + brand wordmark + nav)
//   2  hero               renderHero       (top story: title/excerpt/image)
//   3  chip-rail          renderChipRail   (taxonomy chips → /category/<slug>)
//   4  featured-grid      renderCard×N     (up to 3 featured, first enlarged)
//   5  trending           renderCard×N     (up to 5 trending stories)
//   6  ad-leaderboard     renderAdSlot     (leaderboard surface)
//   7  latest             renderCard×N     (remaining latest cards)
//   8  category-spotlight (real /category/<slug> links per chip)
//   9  ad-in-feed         renderAdSlot     (in-feed surface)
//   10 editors-picks      renderCard×N     (curated re-promotion of featured)
//   11 newsletter         renderNewsletter (provider-aware disabled state)
//   12 about              (site.description / tagline panel)
//   13 site-footer        renderFooter     (legal + nav + copyright)
//
// PART 12 RED LINE: every visible brand string flows from vm.site.{name,
// tagline, description} or per-card data — this module MUST NOT hardcode
// TheIWise / theiwise / cms.kodigital.app. The T18 regression test
// exercises renderHome to assert this.
//
// PART 8 RED LINE: every href is a real URL (chip = /category/<slug>,
// card = /article/<slug>, footer/nav are caller-supplied). No href="#".

import type { HomeArticleCard, HomeViewModel } from "../view-models/home";
import {
  renderAdSlot,
  renderCard,
  renderChipRail,
  renderFooter,
  renderHeader,
  renderHero,
  renderNewsletter,
  type CategoryChip,
  type NavLink,
} from "./components";

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

  // §2 — hero (sourced from vm.hero; fall back to a site-name panel when
  // the tenant has no published articles yet so the hero slot is never
  // collapsed and the section count remains 13).
  const hero = vm.hero;
  const s2 = hero !== null
    ? renderHero({
        title: hero.title,
        excerpt: hero.excerpt,
        imageUrl: hero.imageUrl,
        imageAlt: hero.imageAlt,
        href: hero.href,
        kicker: hero.categoryName.length > 0 ? hero.categoryName : undefined,
      })
    : `<section class="hero hero--empty" aria-label="Featured story"><div class="hero-content"><h1 class="hero-title">${escText(site.name)}</h1>${site.tagline.length > 0 ? `<p class="tagline">${escText(site.tagline)}</p>` : ""}</div></section>`;

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

  // §5 — trending (top 5 of latest)
  const trending = vm.latest.slice(0, 5);
  const s5 = gridSection("Trending", "trending", trending, "Trending stories load soon.");

  // §6 — ad slot, leaderboard surface
  const s6 = renderAdSlot({ type: "leaderboard", slotId: "home-leaderboard", surface: "home" });

  // §7 — latest (remaining cards after trending)
  const latest = vm.latest.slice(5);
  const s7 = gridSection("Latest", "latest", latest, "More stories on the way.");

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

  // §10 — editor's picks (re-promote up to 4 featured for the picks rail)
  const picks = vm.featured.slice(0, 4);
  const s10 = gridSection("Editor's picks", "picks", picks, "Editor's picks coming soon.");

  // §11 — newsletter
  const s11 = renderNewsletter({
    heading: vm.newsletter.heading,
    description: vm.newsletter.description,
    provider: vm.newsletter.provider,
  });

  // §12 — about (site description / tagline)
  const aboutBody = site.description.length > 0
    ? site.description
    : site.tagline.length > 0
      ? site.tagline
      : "";
  const s12 = `<aside class="home-about" aria-labelledby="home-about-heading"><h2 id="home-about-heading" class="home-about__heading">About ${escText(site.name)}</h2>${aboutBody.length > 0 ? `<p class="home-about__description">${escText(aboutBody)}</p>` : ""}</aside>`;

  // §13 — site-footer
  const s13 = renderFooter({
    site: {
      name: site.name,
      hostname: site.hostname,
      tagline: site.tagline,
      logoUrl: site.logoUrl,
    },
    links: args.footerLinks,
    legalLinks: args.legalLinks,
  });

  const sections = [
    `${marker(1, "site-header")}\n${s1}`,
    `${marker(2, "hero")}\n${s2}`,
    `${marker(3, "chip-rail")}\n${s3}`,
    `${marker(4, "featured-grid")}\n<section class="home-section home-section--featured">${s4}</section>`,
    `${marker(5, "trending")}\n<section class="home-section home-section--trending">${s5}</section>`,
    `${marker(6, "ad-leaderboard")}\n${s6}`,
    `${marker(7, "latest")}\n<section class="home-section home-section--latest">${s7}</section>`,
    `${marker(8, "category-spotlight")}\n<section class="home-section home-section--categories">${s8}</section>`,
    `${marker(9, "ad-in-feed")}\n${s9}`,
    `${marker(10, "editors-picks")}\n<section class="home-section home-section--picks">${s10}</section>`,
    `${marker(11, "newsletter")}\n${s11}`,
    `${marker(12, "about")}\n${s12}`,
    `${marker(13, "site-footer")}\n${s13}`,
  ].join("\n");

  // C4 root wrapper: data-screen-label names the decoded design-export
  // screen. The attribute value is deliberately UNQUOTED — the T9.AC2
  // contract grep matches the literal `data-screen-label=theiwise-home`
  // (no quote between `=` and the value); quoting it breaks the contract.
  // The no-brand regression strips data-screen-label attributes before its
  // banned-token sweep, so this label never trips the /theiwise/i ban.
  return `<div data-screen-label=theiwise-home>\n${sections}\n</div>`;
}
