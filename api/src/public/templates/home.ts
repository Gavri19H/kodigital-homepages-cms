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

function dedupeByHref(cards: ReadonlyArray<HomeArticleCard>): HomeArticleCard[] {
  const seen = new Set<string>();
  const out: HomeArticleCard[] = [];
  for (const c of cards) {
    if (seen.has(c.href)) continue;
    seen.add(c.href);
    out.push(c);
  }
  return out;
}

// §4 — Featured. Contract §7 root selector `.container.section > .featured`;
// the grid holds up to 3 cards (design §12 featured[3], first = hero). CSS
// (.featured .card:first-child) enlarges the lead card across two rows.
function renderFeaturedSection(cards: ReadonlyArray<HomeArticleCard>): string {
  const head = `<div class="section-head"><h2>Featured</h2></div>`;
  if (cards.length === 0) {
    return `<div class="container section">${head}<p class="section-empty">No featured stories yet.</p></div>`;
  }
  const grid = cards.map(cardFromVm).join("");
  return `<div class="container section">${head}<div class="featured"><div class="grid">${grid}</div></div></div>`;
}

// §6 — Editor's picks. Contract §7 root selector `.container.section >
// .picks-grid` (design §12 editorsPicks { hero, thumbs[3] } = 4 cards). The
// first pick fills the `.picks-hero` column; the next three render as compact
// `.story-row` items (children: img, .body, .meta — contract §11 vocabulary).
function renderStoryRow(c: HomeArticleCard): string {
  const img =
    c.imageUrl !== null && c.imageUrl.length > 0
      ? `<img src="${escAttr(c.imageUrl)}" alt="${escAttr(c.imageAlt ?? "")}" width="88" height="64" loading="lazy" decoding="async">`
      : "";
  const meta = c.categoryName.length > 0 ? `<p class="meta">${escText(c.categoryName)}</p>` : "";
  return `<a class="story-row" href="${escAttr(c.href)}">${img}<div class="body"><h4>${escText(c.title)}</h4>${meta}</div></a>`;
}

function renderPicksSection(cards: ReadonlyArray<HomeArticleCard>): string {
  const head = `<div class="section-head"><h2>Editor's picks</h2></div>`;
  const lead = cards[0];
  if (lead === undefined) {
    return `<div class="container section">${head}<p class="section-empty">Editor's picks coming soon.</p></div>`;
  }
  const heroImg =
    lead.imageUrl !== null && lead.imageUrl.length > 0
      ? `<img class="card-img" src="${escAttr(lead.imageUrl)}" alt="${escAttr(lead.imageAlt ?? "")}" width="640" height="360" loading="lazy" decoding="async">`
      : "";
  const heroExcerpt =
    lead.excerpt.length > 0 ? `<p class="picks-excerpt">${escText(lead.excerpt)}</p>` : "";
  const picksHero = `<article class="picks-hero"><a href="${escAttr(lead.href)}">${heroImg}<h3 class="card-title">${escText(lead.title)}</h3>${heroExcerpt}</a></article>`;
  const rows = cards.slice(1, 4).map(renderStoryRow).join("");
  return `<div class="container section">${head}<div class="picks-grid">${picksHero}<div class="picks-rows">${rows}</div></div></div>`;
}

// §8 — Spotlight. Contract §7 root selector `.section.section--soft >
// .grid.grid-4` (design §12 spotlight items[4]). A soft-background 4-column
// card grid surfacing the spotlight bucket.
function renderSpotlightSection(
  heading: string,
  cards: ReadonlyArray<HomeArticleCard>,
): string {
  const head = `<div class="section-head"><h2>${escText(heading)}</h2></div>`;
  if (cards.length === 0) {
    return `<section class="section section--soft"><div class="container">${head}<p class="section-empty">Spotlight stories coming soon.</p></div></section>`;
  }
  const grid = cards.slice(0, 4).map(cardFromVm).join("");
  return `<section class="section section--soft"><div class="container">${head}<div class="grid grid-4">${grid}</div></div></section>`;
}

// §10 — Latest. Contract §7 root selector `.container.section > .grid.grid-3`.
// Renders the FULL vm.latest bucket (T16/BCL-057: never slice the head off —
// every non-featured article must surface). Each card is a `.home-grid__item`
// grid cell so the home-bucketing count assertion still holds.
function renderLatestSection(cards: ReadonlyArray<HomeArticleCard>): string {
  const head = `<div class="section-head"><h2>Latest</h2></div>`;
  if (cards.length === 0) {
    return `<div class="container section">${head}<p class="section-empty">More stories on the way.</p></div>`;
  }
  const items = cards.map((c) => `<li class="home-grid__item">${cardFromVm(c)}</li>`).join("");
  return `<div class="container section">${head}<ul class="grid grid-3 home-grid home-grid--latest">${items}</ul></div>`;
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

  // §4 — featured. Design §12 featured[3], first = hero: the lead story heads
  // the featured grid (also the §2 hero banner), then the next featured cards.
  const featuredCards = (vm.hero !== null ? [vm.hero, ...vm.featured] : [...vm.featured]).slice(
    0,
    3,
  );
  const s4 = renderFeaturedSection(featuredCards);

  // §5 — ad slot, leaderboard surface
  const s5 = renderAdSlot({ type: "leaderboard", slotId: "home-leaderboard", surface: "home" });

  // §6 — editor's picks. Design §12 editorsPicks{ hero, thumbs[3] } = 4 cards.
  // Prefer the view-model's curated picks bucket; fall back to hero + featured.
  const picksCards = (
    vm.picks.length > 0
      ? vm.picks
      : vm.hero !== null
        ? [vm.hero, ...vm.featured]
        : [...vm.featured]
  ).slice(0, 4);
  const s6 = renderPicksSection(picksCards);

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

  // §8 — spotlight. Design §12 spotlight items[4]: a soft-background 4-card
  // grid. Prefer the view-model's spotlight bucket (a by-category lens built
  // in buildHomeViewModel); fall back to a deduped featured+latest slice so
  // the section is populated even for view-model literals that omit it. The
  // heading names the spotlight category when known.
  const spotlightCards = (
    vm.spotlight !== undefined && vm.spotlight.length > 0
      ? vm.spotlight
      : dedupeByHref([...vm.featured, ...vm.latest])
  ).slice(0, 4);
  const spotlightLead = spotlightCards[0];
  const spotlightHeading =
    spotlightLead !== undefined && spotlightLead.categoryName.length > 0
      ? spotlightLead.categoryName
      : "Spotlight";
  const s8 = renderSpotlightSection(spotlightHeading, spotlightCards);

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
  const s10 = renderLatestSection(vm.latest);

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
    `${marker(4, "featured")}\n${s4}`,
    `${marker(5, "ad-leaderboard")}\n${s5}`,
    `${marker(6, "editors-picks")}\n<div id="picks">${s6}</div>`,
    `${marker(7, "trending")}\n<section class="home-section home-section--trending trending-section" id="trending">${s7}</section>`,
    `${marker(8, "spotlight")}\n${s8}`,
    `${marker(9, "ad-in-feed")}\n${s9}`,
    `${marker(10, "latest")}\n${s10}`,
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
