// Phase 5 / T15 [C10]: Trending dark strip — Home §7 per docs/design-contract.md.
// Root selector `.trending-section` (dark, full-bleed) is applied by the
// caller's section wrapper; this module renders the inner `.container` with
// the pulse-dot section head and the ranked 5-column `.grid`. Vocabulary is
// contract §10: trending-section / trending-num / trending-img / trending-cat /
// trending-h / pulse-dot. `.trending-num` is String(i + 1).padStart(2, "0") —
// contract-verbatim. PART 8 RED LINE: every item links its real article URL.

import { escAttr, escText } from "./esc";
import { responsiveImg } from "./responsive-img";

export interface TrendingItem {
  href: string;
  title: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  categoryName?: string | null;
}

export interface TrendingArgs {
  items: ReadonlyArray<TrendingItem>;
  heading?: string;
  emptyLabel?: string;
}

export function renderTrending(args: TrendingArgs): string {
  // Design Trending head: a pulse-dot + "Trending now" title and an eyebrow.
  const heading = args.heading !== undefined && args.heading.length > 0 ? args.heading : "Trending now";
  const head =
    `<div class="section-head"><div class="section-head-left">` +
    `<h2 class="section-title trending-title"><span class="pulse-dot" aria-hidden="true"></span>${escText(heading)}</h2>` +
    `<span class="section-eyebrow trending-eyebrow">The five stories saved most in the last 24 hours</span>` +
    `</div></div>`;
  const items = args.items ?? [];
  if (items.length === 0) {
    const empty =
      args.emptyLabel !== undefined && args.emptyLabel.length > 0
        ? args.emptyLabel
        : "Trending stories load soon.";
    return `<div class="container">${head}<p class="section-empty">${escText(empty)}</p></div>`;
  }
  // Design trending item: the whole item is an <a> (NOT a wrapping <li>), with
  // .trending-num + .trending-img (img|.ph) + .trending-body (.trending-cat +
  // h4.trending-h). `.trending-num` = String(i+1).padStart(2,"0") (verbatim).
  const lis = items
    .map((item, i) => {
      const num = String(i + 1).padStart(2, "0");
      const realImg = responsiveImg({
        src: item.imageUrl,
        alt: item.imageAlt ?? item.title,
        width: 640,
        height: 400,
        loading: "lazy",
        sizes: "(max-width: 880px) 50vw, 20vw",
      });
      const clabel =
        item.categoryName !== undefined && item.categoryName !== null && item.categoryName.length > 0
          ? item.categoryName
          : item.title;
      const imgInner =
        realImg.length > 0
          ? realImg
          : `<div class="ph" data-label="${escAttr(clabel)}" style="--ph-a:#3a4150;--ph-b:#1ba8c8"></div>`;
      const cat =
        item.categoryName !== undefined && item.categoryName !== null && item.categoryName.length > 0
          ? `<span class="trending-cat">${escText(item.categoryName)}</span>`
          : "";
      return `<a class="trending-item" href="${escAttr(item.href)}"><span class="trending-num">${num}</span><div class="trending-img">${imgInner}</div><div class="trending-body">${cat}<h4 class="trending-h">${escText(item.title)}</h4></div></a>`;
    })
    .join("");
  return `<div class="container">${head}<div class="trending-scroll">${lis}</div></div>`;
}
