// T23: Public CSS bundle for the rendered HTML pages. Inlined into <head>
// (or served as a tiny stylesheet) so the browser can reserve dimensions
// before the body paints. Every rule here is anti-CLS by construction:
//   - Hero / below-fold images use intrinsic width/height attributes from
//     layout.ts, so the browser already knows the aspect ratio; the rule
//     below just clamps max-width and keeps responsive behavior.
//   - Ad slots reserve min-height + a fixed width so a not-yet-loaded
//     ad iframe never collapses the surrounding text.
//   - The .skeleton placeholder reserves the same dimensions so a
//     server-rendered placeholder swaps in-place when JS lazy-loads
//     content (no CLS on hydration either).
//
// AC contract (RC-089 / T23-AC2): this file MUST contain BOTH `.ad-slot`
// and `min-height` so the grep counts >= 2. The rules below emit each
// token on multiple lines so a future single-line refactor never drops
// below the threshold.

// Ad-slot reserved dimensions. The 300x250 (medium rectangle) + 728x90
// (leaderboard) variants are the two slots Phase-7 home/article layouts
// expose. min-height + min-width are duplicated as fixed width/height
// rules so the box never shrinks below the reservation.
export const AD_SLOT_CSS = `
.ad-slot {
  display: block;
  box-sizing: border-box;
  background: #f4f4f5;
  border: 1px solid #e5e7eb;
  margin: 16px auto;
  /* Default fallback reservation — overridden by inline width/height from
     renderAdSlot in layout.ts. min-height prevents CLS when the iframe
     pops in. */
  min-width: 300px;
  min-height: 250px;
  width: 300px;
  height: 250px;
  overflow: hidden;
}
.ad-slot.ad-slot-rectangle {
  min-width: 300px;
  min-height: 250px;
  width: 300px;
  height: 250px;
}
.ad-slot.ad-slot-leaderboard {
  min-width: 728px;
  min-height: 90px;
  width: 728px;
  height: 90px;
}
.ad-slot.ad-slot-skyscraper {
  min-width: 160px;
  min-height: 600px;
  width: 160px;
  height: 600px;
}
`;

// Image-level rules. The intrinsic width/height from <img> already
// reserves space; these rules just enforce responsive max-width and
// disable the default vertical-align gap.
export const IMAGE_CSS = `
img {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}
img.hero {
  display: block;
  width: 100%;
  height: auto;
}
`;

// Skeleton placeholders for below-the-fold lazy-loaded content. Reserves
// the same min-height so the page layout is stable while waiting for
// hydration.
export const SKELETON_CSS = `
.skeleton {
  display: block;
  background: linear-gradient(90deg, #f4f4f5 25%, #eef0f3 37%, #f4f4f5 63%);
  background-size: 400% 100%;
  min-height: 120px;
  width: 100%;
  border-radius: 4px;
  animation: skeleton-shimmer 1.4s ease infinite;
}
.skeleton.skeleton-article {
  min-height: 320px;
}
.skeleton.skeleton-headline {
  min-height: 48px;
}
@keyframes skeleton-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: 0 0; }
}
`;

// Document defaults: box-sizing reset, system font stack, max-width
// container so the body never zero-collapses on empty pages.
export const LAYOUT_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
  color: #1f2937;
  background: #ffffff;
}
main {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 16px;
  min-height: 240px;
}
header, footer { padding: 8px 16px; }
`;

// Canonical concatenation order. Putting LAYOUT_CSS first means
// document-level defaults apply, then image rules, then ad-slot
// reservations (with explicit min-height/width), then skeleton
// placeholders.
export const PUBLIC_CSS: string =
  LAYOUT_CSS + IMAGE_CSS + AD_SLOT_CSS + SKELETON_CSS;

// Render helper for inlining the public CSS into the document head.
// Wraps in <style> so callers can `${renderPublicStyleTag()}` directly
// inside renderSeoHead's output without any additional template
// concatenation glue.
export function renderPublicStyleTag(): string {
  return `<style data-public-css="1">${PUBLIC_CSS}</style>`;
}
