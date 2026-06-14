// Phase 5 / T15 [C10]: Trending dark strip — Home §7 per docs/design-contract.md.
// Root selector `.trending-section` (dark, full-bleed) is applied by the
// caller's section wrapper; this module renders the inner `.container` with
// the pulse-dot section head and the ranked 5-column `.grid`. Vocabulary is
// contract §10: trending-section / trending-num / trending-img / trending-cat /
// trending-h / pulse-dot. `.trending-num` is String(i + 1).padStart(2, "0") —
// contract-verbatim. PART 8 RED LINE: every item links its real article URL.

import { escAttr, escText, imgTag } from "./esc";

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
  const heading = args.heading !== undefined && args.heading.length > 0 ? args.heading : "Trending";
  const head = `<div class="section-head"><h2><span class="pulse-dot" aria-hidden="true"></span>${escText(heading)}</h2></div>`;
  const items = args.items ?? [];
  if (items.length === 0) {
    const empty =
      args.emptyLabel !== undefined && args.emptyLabel.length > 0
        ? args.emptyLabel
        : "Trending stories load soon.";
    return `<div class="container">${head}<p class="section-empty">${escText(empty)}</p></div>`;
  }
  const lis = items
    .map((item, i) => {
      const num = String(i + 1).padStart(2, "0");
      const img = imgTag(
        item.imageUrl,
        item.imageAlt ?? item.title,
        ' class="trending-img" width="640" height="400" loading="lazy" decoding="async"',
      );
      const cat =
        item.categoryName !== undefined && item.categoryName !== null && item.categoryName.length > 0
          ? `<span class="trending-cat">${escText(item.categoryName)}</span>`
          : "";
      return `<li class="trending-item"><span class="trending-num">${num}</span><a href="${escAttr(item.href)}">${img}${cat}<h3 class="trending-h">${escText(item.title)}</h3></a></li>`;
    })
    .join("");
  return `<div class="container">${head}<ol class="grid">${lis}</ol></div>`;
}
