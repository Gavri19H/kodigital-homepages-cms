// C8 / T13: renderArticle composes the public Article body in the decoded
// design-contract §8 order (docs/design-contract.md). The function returns a
// body fragment (no `<html>` wrapper — the layout in templates/layout.ts
// wraps it). renderArticle EMITS its own inline
// `<script type="application/ld+json">` blocks for Article + BreadcrumbList
// + (optional) FAQPage so the JSON-LD presence regression can detect them on
// the rendered body alone.
//
// RESCUE-4 RE-SKIN (2026-06-21): the rendered DOM below matches the claude.ai
// design `ArticleApp` 1:1 — the hero (`.article-hero-img` wrapper + overlay +
// `.container .article-hero-content` with `.article-cat`/`.article-title`/
// `.article-subtitle`/`.article-meta` carrying a `.card-avatar` + byline/date),
// the `.article-shell` (share-rail / `.article-body` with drop-cap p, h2,
// brand-dash ul, `.pullquote` w/ `.pq-mark`, `.article-figure > .figure-img`,
// `.callout-box`, `.affiliate-card`, FAQs as `.faq-list > details`,
// `.article-share-bottom`), the `.article-sidebar` (toc / mini newsletter /
// rect ad / `.sidebar-popular`), and the `.related-section` "Keep reading"
// grid. Header/footer/newsletter/ad-slot/avatar come from components.ts
// (the home re-skin already matched them) — NOT re-implemented here.
//
// Contract §8 divides Article into 12 ordered sections with explicit
// NESTING: §§5–9 live INSIDE the §4 article-shell, and §§7–8 live INSIDE
// the §6 article-body. Each section is delimited by an
// `<!-- article-section:N name -->` comment so the section-order behavioural
// test can assert the marker sequence AND the nesting without depending on
// CSS class names. Markers for conditionally-empty sections (faq-section,
// related cards) always render so the count stays 12.
//
// Section catalogue (§8, numerical = render order; indent = nesting):
//   1  reading-progress     fixed top 3px bar — INDEX 0 of the page
//   2  site-header          renderHeader (same pattern as Home)
//   3  article-hero         full-bleed, dark gradient overlay
//   4  article-shell        `.article-shell.container` — wrapper for 5–9
//   5    share-rail         inside shell; sticky; hidden < 1080px
//   6    article-body       `article.article-body`; holds body blocks + 7, 8
//   7      faq-section      nested inside article-body
//   8      article-share-bottom  nested inside article-body
//   9    article-sidebar    inside shell; sticky; below body < 800px
//   10 related-section      soft-bg, `.grid.grid-4`
//   11 newsletter           reused from home
//   12 site-footer          reused from home (+ floating-next overlay,
//                           a fixed-position element, not a §8 section)
//
// There is NO top-level ad-leaderboard / ad-in-feed on Article (§8). The
// only Article ad is the 300×250 rect INSIDE the sidebar:
// `.sidebar-ad.ad-slot--rect` (§10/§11). Sidebar card order (§11):
// toc → sidebar-newsletter → sidebar-ad → sidebar-popular.
//
// There is NO visible breadcrumb section on Article (§8 lists 12 sections;
// none is a breadcrumb, and §10's class vocabulary has no breadcrumb class).
// The BreadcrumbList JSON-LD payload still always renders.
//
// PART 12 RED LINE: every visible brand string flows from
// vm.site.{name,tagline,description} or per-article data — this module
// MUST NOT hardcode TheIWise / theiwise / cms.kodigital.app. The T18
// regression test exercises renderArticle to assert this.
//
// PART 8 RED LINE: every href is a real URL. No href="#". The share buttons
// are <button> JS actions (data-share → public.js Web Share / clipboard),
// never anchors.
//
// PART 4 RED LINE: the rendered HTML MUST contain the literal
// `minmax(0, 1fr)` inside the article-shell wrapper so a CSS-less
// snapshot still records the column contract.
//
// PART 6 RED LINE: an Article with no FAQ blocks MUST NOT emit a
// FAQPage JSON-LD payload. buildFaqJsonLd already returns "" for empty
// faqs[]; we only emit the `<script>` when the payload is non-empty.

import type { ArticleViewModel } from "../view-models/article";
import {
  renderAdSlot,
  renderCard,
  renderFooter,
  renderFloatingNext,
  renderHeader,
  renderNewsletter,
  type NavLink,
  type SocialLink,
} from "./components";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
} from "./seo";
import { responsiveImg } from "./responsive-img";
import { iconChevronDown } from "./icons";
import type { AdsConfig } from "../ads";

export interface RenderArticleArgs {
  vm: ArticleViewModel;
  nav?: ReadonlyArray<NavLink>;
  footerLinks?: ReadonlyArray<NavLink>;
  legalLinks?: ReadonlyArray<NavLink>;
  // T28: operator-set social-media links rendered in the §12 site-footer.
  socialLinks?: ReadonlyArray<SocialLink>;
  newsletterHeading?: string;
  newsletterDescription?: string;
  newsletterProvider?: string | null;
  // T22: the per-site ad config. When present + AdSense is live the §11
  // sidebar rectangle slot emits its real <ins> unit; omitted = placeholder.
  ads?: AdsConfig;
  // When false, the design body is returned WITHOUT its own inline
  // Article / BreadcrumbList / FAQPage JSON-LD <script> blocks. The live
  // article route (render-pages.renderArticleHtml, T2) sets this so the
  // served page carries exactly ONE Article block — the GEO-conformant,
  // pretty-printed payload emitted in the <head> via renderLayout.extraHead.
  // Design-template callers (and the public-templates-article tests) omit
  // the flag, so it defaults to true and their JSON-LD guards are unaffected.
  emitJsonLd?: boolean;
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
  return `<!-- article-section:${n} ${name} -->`;
}

// Affiliate CTA href guard: only well-formed web/mail/relative URLs are emitted
// as a link; anything else (javascript:, data:, …) drops the outbound anchor.
function isSafeHref(url: string): boolean {
  const u = url.trim().toLowerCase();
  return (
    u.startsWith("https://") ||
    u.startsWith("http://") ||
    u.startsWith("mailto:") ||
    u.startsWith("/")
  );
}

// The site-name initial used for the hero byline avatar — mirrors the design
// `.card-avatar` brand mark (and the components.ts header/footer brand glyph).
// Sourced from the view-model, never hardcoded (PART 12).
function avatarInitial(name: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "•";
}

function renderArticleHero(article: ArticleViewModel["article"], siteName: string): string {
  // §3 hero is the LCP candidate: a responsive (/media/ src, T21) <img> at the
  // design dimensions (1200×630), loaded eager with fetchpriority="high",
  // wrapped in the design `.article-hero-img` div (object-fit:cover fill).
  // responsiveImg returns "" when imageUrl is absent → the wrapper holds a `.ph`
  // gradient placeholder instead so the hero box is never empty.
  const heroImg = responsiveImg({
    src: article.imageUrl,
    alt: article.imageAlt,
    width: 1200,
    height: 630,
    loading: "eager",
    fetchpriority: "high",
    sizes: "100vw",
  });
  const heroInner =
    heroImg.length > 0
      ? heroImg
      : `<div class="ph" data-label="${escAttr(article.title)}" style="--ph-a:#c8d8e8;--ph-b:#1ba8c8"></div>`;
  const categoryHtml =
    article.categoryName.length > 0
      ? `<a class="article-cat" href="${escAttr(article.categoryHref)}">${escText(article.categoryName)}</a>`
      : "";
  const subtitleHtml =
    article.excerpt.length > 0
      ? `<p class="article-subtitle">${escText(article.excerpt)}</p>`
      : "";

  // §3 meta row (design): a `.card-avatar` brand mark + `.article-meta-text`
  // holding the byline and the "{publishedAt} · {readTime}" date line. The
  // byline is the author name when present, else the brand-house "<strong>{site}</strong>
  // Recommends" form. The avatar initial is the article author's (or site's).
  const bylineName =
    article.author !== null && article.author.name.length > 0
      ? escText(article.author.name)
      : `<strong>${escText(siteName)}</strong> Recommends`;
  const avatarSource =
    article.author !== null && article.author.name.length > 0
      ? article.author.name
      : siteName;
  const avatarHtml = `<span class="card-avatar is-brand" aria-hidden="true">${escText(avatarInitial(avatarSource))}</span>`;
  const dateParts: string[] = [];
  if (article.publishedAtDisplay.length > 0) {
    dateParts.push(
      `<time datetime="${escAttr(article.publishedAt)}">${escText(article.publishedAtDisplay)}</time>`,
    );
  }
  if (article.readMinutesDisplay.length > 0) {
    dateParts.push(escText(article.readMinutesDisplay));
  }
  const dateHtml =
    dateParts.length > 0
      ? `<span class="article-date">${dateParts.join(" · ")}</span>`
      : "";
  const metaHtml = `<div class="article-meta">${avatarHtml}<div class="article-meta-text"><span class="article-byline">${bylineName}</span>${dateHtml}</div></div>`;

  return `<section class="article-hero" aria-labelledby="article-title">
  <div class="article-hero-img">${heroInner}</div>
  <div class="article-hero-overlay"></div>
  <div class="container article-hero-content">
    ${categoryHtml}
    <h1 id="article-title" class="article-title">${escText(article.title)}</h1>
    ${subtitleHtml}
    ${metaHtml}
  </div>
</section>`;
}

function renderBlockHtml(
  block: ArticleViewModel["article"]["body"][number],
  headingIndex: number,
): string {
  switch (block.type) {
    case "paragraph":
      // §12 `p` — a real <p> direct child of `.article-body` so the drop-cap
      // (`.article-body > p:first-of-type::first-letter`) lands on the lede.
      return block.text.length > 0 ? `<p>${escText(block.text)}</p>` : "";
    case "html":
      return block.html.length > 0 ? `<div class="article-body__html">${block.html}</div>` : "";
    case "heading": {
      const tag = block.level === 3 ? "h3" : "h2";
      // The id anchors the sidebar TOC links (#article-heading-N). The
      // `.article-body__heading` class is harmless under the design's
      // element-scoped `.article-body > h2` rule.
      return `<${tag} id="article-heading-${headingIndex}" class="article-body__heading">${escText(block.text)}</${tag}>`;
    }
    case "image": {
      // §12 `image` → design `<figure class="article-figure"><div class="figure-img"><img></div><figcaption>`.
      const caption =
        block.caption !== null && block.caption.length > 0
          ? `<figcaption>${escText(block.caption)}</figcaption>`
          : "";
      return `<figure class="article-figure"><div class="figure-img"><img src="${escAttr(block.src)}" alt="${escAttr(block.alt)}" width="1200" height="675" loading="lazy" decoding="async"></div>${caption}</figure>`;
    }
    case "quote": {
      // §12 `pullquote` → design `<blockquote class="pullquote"><span class="pq-mark">"</span>{text}</blockquote>`.
      // An optional <cite> trails the quote when the block carries an attribution.
      const cite =
        block.cite !== null && block.cite.length > 0
          ? `<cite>${escText(block.cite)}</cite>`
          : "";
      return `<blockquote class="pullquote"><span class="pq-mark" aria-hidden="true">"</span>${escText(block.text)}${cite}</blockquote>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((i) => `<li>${escText(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "code":
      return `<pre><code${block.language !== null ? ` class="language-${escAttr(block.language)}"` : ""}>${escText(block.code)}</code></pre>`;
    case "callout": {
      // §12 `callout` → design `<div class="callout-box"><h4>{title}</h4>…</div>`
      // (brand-tint box, public-css.ts). The worker callout VM carries a single
      // free-text body (not list items), so the body renders as a <p>; the
      // design's <ul><li> checklist form is for list-shaped callouts.
      const title =
        block.title !== null && block.title.length > 0
          ? `<h4>${escText(block.title)}</h4>`
          : "";
      const body = block.text.length > 0 ? `<p>${escText(block.text)}</p>` : "";
      return `<div class="callout-box">${title}${body}</div>`;
    }
    case "affiliate": {
      // §12 `affiliate` → design `<a class="affiliate-card">` (the whole card is
      // the link) with `.affiliate-img` thumb, `.affiliate-body` (eyebrow +
      // h4 name + price) and an `.affiliate-cta` "Shop →" pill. The worker VM
      // carries title/description/url/cta only (no image, no price), so the
      // thumb is a `.ph` placeholder, the eyebrow is the design's static
      // "Editor's pick" label, price is omitted, and the description rides as
      // the price-line subtext. When the url is safe the card is an <a> with the
      // sponsored/nofollow rel; otherwise it degrades to a non-link <div>.
      const name =
        block.title !== null && block.title.length > 0
          ? `<h4>${escText(block.title)}</h4>`
          : "";
      const desc =
        block.description !== null && block.description.length > 0
          ? `<span class="affiliate-price">${escText(block.description)}</span>`
          : "";
      const inner =
        `<div class="affiliate-img"><div class="ph" data-label="${escAttr(block.title ?? "")}" style="--ph-a:#c8d8e8;--ph-b:#1ba8c8"></div></div>` +
        `<div class="affiliate-body"><span class="affiliate-eyebrow">Editor's pick</span>${name}${desc}</div>` +
        `<span class="affiliate-cta">${escText(block.cta)} →</span>`;
      return block.url !== null && isSafeHref(block.url)
        ? `<a class="affiliate-card" href="${escAttr(block.url)}" target="_blank" rel="sponsored nofollow noopener">${inner}</a>`
        : `<div class="affiliate-card">${inner}</div>`;
    }
    case "faq":
      return `<details class="article-body__faq"><summary>${escText(block.question)}</summary><div>${escText(block.answer)}</div></details>`;
  }
}

function renderArticleBodyBlocks(article: ArticleViewModel["article"]): string {
  if (article.body.length === 0) return "";
  let headingIndex = 0;
  return article.body
    .map((block) => {
      if (block.type === "heading") headingIndex += 1;
      return renderBlockHtml(block, headingIndex);
    })
    .join("\n");
}

// §11 sidebar card order: toc → sidebar-newsletter → sidebar-ad → popular.
// Matches the design `Sidebar`: `.sidebar-card` (`.sidebar-title` h4 + `.toc`
// ol), `.sidebar-newsletter` (mini newsletter form), `.sidebar-ad.ad-slot--rect`
// (the rect ad — kept as the worker ad subsystem's `rect` type so renderAdSlot's
// data-ad-type/data-ad-slot contract holds), then `.sidebar-popular`
// (`.pop-num`/`.pop-img`/`.pop-body` rows).
function renderSidebar(vm: ArticleViewModel, ads?: AdsConfig): string {
  const tocItems = vm.article.body
    .filter((b) => b.type === "heading")
    .map((b, i) => `<li><a href="#article-heading-${i + 1}">${escText((b as { text: string }).text)}</a></li>`)
    .join("");
  const tocHtml =
    tocItems.length > 0
      ? `<div class="sidebar-card"><h4 class="sidebar-title">In this article</h4><ol class="toc">${tocItems}</ol></div>`
      : "";

  // Design `.sidebar-newsletter`: a brand-tint card with a mini inline form
  // (`.newsletter-form.mini`). The submit posts to the same public endpoint as
  // the main newsletter; PART 8 — no href="#".
  const newsletterHtml = `<div class="sidebar-newsletter"><h4>Get the newsletter</h4><p>The best stories in your inbox each week.</p><form class="newsletter-form mini" method="post" action="/api/newsletter/subscribe"><label class="newsletter-label-sr" for="sidebar-newsletter-email">Email address</label><input id="sidebar-newsletter-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><button class="btn-primary" type="submit">Join</button></form></div>`;

  // §11 sidebar ad: the `.sidebar-ad.ad-slot--rect` wrapper around the rect
  // renderAdSlot node (data-ad-slot/data-ad-type contract).
  const adHtml = `<div class="sidebar-card sidebar-ad ad-slot--rect">${renderAdSlot({ type: "rect", slotId: "article-sidebar-ad", surface: "article", ads })}</div>`;

  // Design `.sidebar-popular`: a numbered list, each row a 24px `.pop-num` +
  // a 60×60 `.pop-img` thumb + a `.pop-body` (`.pop-cat` + `.pop-title`).
  // The thumb is a /media/ <img> (T21) at the design 60×60; below-fold → lazy.
  const popularItems = vm.related
    .slice(0, 5)
    .map((c, i) => {
      const thumb = responsiveImg({
        src: c.imageUrl,
        alt: c.imageAlt,
        width: 60,
        height: 60,
        loading: "lazy",
        sizes: "60px",
      });
      const thumbInner =
        thumb.length > 0
          ? thumb
          : `<div class="ph" data-label="${escAttr(c.categoryName.length > 0 ? c.categoryName : c.title)}" style="--ph-a:#c8d8e8;--ph-b:#1ba8c8"></div>`;
      const num = String(i + 1).padStart(2, "0");
      const cat =
        c.categoryName.length > 0
          ? `<span class="pop-cat">${escText(c.categoryName)}</span>`
          : "";
      return `<li><a href="${escAttr(c.href)}"><span class="pop-num">${num}</span><span class="pop-img">${thumbInner}</span><span class="pop-body">${cat}<span class="pop-title">${escText(c.title)}</span></span></a></li>`;
    })
    .join("");
  const popularHtml =
    popularItems.length > 0
      ? `<div class="sidebar-card"><h4 class="sidebar-title">Popular this week</h4><ul class="sidebar-popular">${popularItems}</ul></div>`
      : "";
  return `<aside class="article-sidebar">${tocHtml}${newsletterHtml}${adHtml}${popularHtml}</aside>`;
}

// T16/BCL-057: the share URL MUST resolve to the tenant's real address.
// `hostname` is vm.site.hostname (= siteContext.hostname, the live request
// host); article.href is `/article/<slug>`, so the rail URL equals the page's
// canonicalUrl. The design share rail is three round `.share-btn` (Save / Share
// / Copy) + a `.share-count`. The Share + Copy buttons carry data-share +
// data-share-url so public.js wires the Web Share API / clipboard fallback;
// Save is a local bookmark affordance (data-share-action="save"). PART 8 — all
// are <button> JS actions, never anchors.
function renderShareRail(article: ArticleViewModel["article"], hostname: string): string {
  const url = escAttr(`https://${hostname}${article.href}`);
  return `<aside class="share-rail" aria-label="Share this story">
  <button class="share-btn" type="button" data-share-action="save" aria-label="Save this story">🔖</button>
  <button class="share-btn" type="button" data-share data-share-url="${url}" aria-label="Share">↗</button>
  <button class="share-btn" type="button" data-share data-share-url="${url}" data-share-action="copy" aria-label="Copy link">🔗</button>
  <span class="share-count" aria-hidden="true">0</span>
</aside>`;
}

function renderFaqSection(faqs: ArticleViewModel["faqs"]): string {
  if (faqs.length === 0) return "";
  // Design `.faq-section`: an h2 + a `.faq-list` of <details> rows, each summary
  // carrying a chevron svg the CSS rotates on [open].
  const chevron = iconChevronDown({ className: "faq-chevron", size: 18 });
  const items = faqs
    .map(
      (f) =>
        `<details><summary>${escText(f.question)}${chevron}</summary><p>${escText(f.answer)}</p></details>`,
    )
    .join("");
  return `<section class="faq-section" aria-labelledby="faq-heading"><h2 id="faq-heading">Frequently asked questions</h2><div class="faq-list">${items}</div></section>`;
}

function renderRelated(related: ArticleViewModel["related"]): string {
  if (related.length === 0) {
    return `<p class="section-empty">More stories coming soon.</p>`;
  }
  const cards = related
    .map((c) =>
      renderCard({
        href: c.href,
        title: c.title,
        excerpt: c.excerpt,
        imageUrl: c.imageUrl,
        imageAlt: c.imageAlt,
        publishedAt: c.publishedAt,
        categoryName: c.categoryName,
        readMinutes: c.readMinutes,
      }),
    )
    .join("");
  return `<div class="grid grid-4">${cards}</div>`;
}

function renderJsonLdScripts(blocks: ReadonlyArray<string>): string {
  return blocks
    .filter((s) => typeof s === "string" && s.length > 0)
    .map((s) => `<script type="application/ld+json">${s.replace(/<\/script/gi, "<\\/script")}</script>`)
    .join("\n");
}

export function renderArticle(args: RenderArticleArgs): string {
  const vm = args.vm;
  const site = vm.site;
  const article = vm.article;

  // §1 — reading-progress: index 0 of the page (before the header).
  const s1 = `<div class="reading-progress" aria-hidden="true"><div class="reading-progress-bar"></div></div>`;

  const s2 = renderHeader({
    site: {
      name: site.name,
      tagline: site.tagline,
      logoUrl: site.logoUrl,
      hostname: site.hostname,
    },
    nav: args.nav,
  });

  const s3 = renderArticleHero(article, site.name);

  // §4 article-shell wraps §§5–9; §§7–8 nest INSIDE the §6 article-body.
  // The shell carries the literal minmax(0, 1fr) so a CSS-less snapshot
  // still records the column contract (PART 4 RED LINE).
  const s4 = `<div class="article-shell container" data-grid="60px minmax(0, 1fr) 320px">
  ${marker(5, "share-rail")}
  ${renderShareRail(article, site.hostname)}
  ${marker(6, "article-body")}
  <article class="article-body" id="article-content">
    ${renderArticleBodyBlocks(article)}
    ${marker(7, "faq-section")}
    ${renderFaqSection(vm.faqs)}
    ${marker(8, "article-share-bottom")}
    <div class="article-share-bottom" aria-label="Share this story">
  <button class="btn-outline" type="button" data-share-action="save">Save this story</button>
  <button class="btn-primary" type="button" data-share data-share-url="${escAttr(`https://${site.hostname}${article.href}`)}">Share</button>
</div>
  </article>
  ${marker(9, "article-sidebar")}
  ${renderSidebar(vm, args.ads)}
</div>`;

  // §10 related "Keep reading" grid. Class stays `related-section section--soft`
  // (the contract-order test pins it); the design head carries the eyebrow +
  // a real "back to home" section link (PART 8 — no href="#").
  const s10 = `<section class="related-section section--soft" aria-labelledby="related-heading"><div class="container"><div class="section-head"><div class="section-head-left"><h2 id="related-heading" class="section-title">Keep reading</h2><span class="section-eyebrow">More stories you'll like</span></div><a class="section-link" href="/">back to home →</a></div>${renderRelated(vm.related)}</div></section>`;

  const newsletterHeading =
    args.newsletterHeading !== undefined && args.newsletterHeading.length > 0
      ? args.newsletterHeading
      : site.name.length > 0
        ? `${site.name} newsletter`
        : "Newsletter";
  const s11 = renderNewsletter({
    heading: newsletterHeading,
    description: args.newsletterDescription ?? site.tagline,
    provider: args.newsletterProvider ?? null,
  });

  const footerHtml = renderFooter({
    site: {
      name: site.name,
      hostname: site.hostname,
      tagline: site.tagline,
      logoUrl: site.logoUrl,
    },
    links: args.footerLinks,
    legalLinks: args.legalLinks,
    socialLinks: args.socialLinks,
  });
  // floating-next is a fixed-position overlay (§11), not a §8 section; it
  // rides inside §12 so the marker count stays exactly 12.
  const [firstRelated] = vm.related;
  const floatingHtml = firstRelated !== undefined
    ? renderFloatingNext({
        href: firstRelated.href,
        label: firstRelated.title,
        imageUrl: firstRelated.imageUrl,
        imageAlt: firstRelated.imageAlt,
      })
    : "";
  const s12 = `${footerHtml}${floatingHtml}`;

  // JSON-LD: Article + BreadcrumbList always; FAQPage only when faqs[]
  // is non-empty (PART 6 RED LINE). Suppressed entirely when emitJsonLd is
  // false — the live article route (T2) carries the GEO-conformant payload
  // in the <head> instead, so the design body must not duplicate it.
  const jsonLdBlocks: string[] = [];
  if (args.emitJsonLd !== false) {
    jsonLdBlocks.push(
      buildArticleJsonLd({
        site: {
          name: site.name,
          hostname: site.hostname,
          tagline: site.tagline,
          description: site.description,
          logoUrl: site.logoUrl,
        },
        article: {
          title: article.title,
          slug: article.slug,
          excerpt: article.excerpt,
          imageUrl: article.imageUrl,
          publishedAt: article.publishedAt,
          author: article.author ?? undefined,
          modifiedAt: article.updatedAt,
        },
      }),
    );
    jsonLdBlocks.push(
      buildBreadcrumbJsonLd({
        site: { name: site.name, hostname: site.hostname },
        items: vm.breadcrumb,
      }),
    );
    const faqJsonLd = buildFaqJsonLd({ faqs: vm.faqs });
    if (faqJsonLd.length > 0) jsonLdBlocks.push(faqJsonLd);
  }
  const jsonLdHtml = renderJsonLdScripts(jsonLdBlocks);

  const sections = [
    `${marker(1, "reading-progress")}\n${s1}`,
    `${marker(2, "site-header")}\n${s2}`,
    `${marker(3, "article-hero")}\n${s3}`,
    `${marker(4, "article-shell")}\n${s4}`,
    `${marker(10, "related-section")}\n${s10}`,
    `${marker(11, "newsletter")}\n${s11}`,
    `${marker(12, "site-footer")}\n${s12}`,
    jsonLdHtml,
  ].join("\n");

  // C4 root wrapper: data-screen-label names the decoded design-export
  // screen. UNQUOTED on purpose to mirror the Home wrapper's contract-grep
  // form (T9.AC2 matches the literal unquoted attribute).
  return `<div data-screen-label=article-page>\n${sections}\n</div>`;
}
