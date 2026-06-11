// Phase 5 / T11: renderArticle composes the public Article body in PART 2
// order. The function returns a body fragment (no `<html>` wrapper — the
// layout in templates/layout.ts wraps it). renderArticle EMITS its own
// inline `<script type="application/ld+json">` blocks for Article +
// BreadcrumbList + (optional) FAQPage so the JSON-LD presence regression
// (T19) can detect them on the rendered body alone.
//
// PART 2 (session-4 spec) divides Article into 12 ordered sections. Each
// section is delimited by an `<!-- article-section:N name -->` comment
// so the section-order behavioural test can count them and assert their
// numerical order without depending on CSS class names.
//
// Section catalogue (numerical = render order):
//   1  site-header        renderHeader     (banner + brand wordmark + nav)
//   2  breadcrumb         crumbs from vm.breadcrumb
//   3  article-hero       title + subtitle + meta + hero image
//   4  reading-progress   top progress bar (article-only)
//   5  ad-leaderboard     renderAdSlot leaderboard
//   6  article-shell      share-rail + article-body + sidebar (minmax(0,1fr))
//   7  faq-section        details/summary FAQ list (omitted when faqs=[])
//   8  ad-in-feed         renderAdSlot in-feed surface
//   9  article-share-bottom share buttons after body
//   10 related-section    renderCard×N from vm.related
//   11 newsletter         renderNewsletter (provider-aware disabled state)
//   12 site-footer        renderFooter + renderFloatingNext (>=1280px)
//
// PART 12 RED LINE: every visible brand string flows from
// vm.site.{name,tagline,description} or per-article data — this module
// MUST NOT hardcode TheIWise / theiwise / cms.kodigital.app. The T18
// regression test exercises renderArticle to assert this.
//
// PART 8 RED LINE: every href is a real URL (breadcrumb/related links
// are real paths). No href="#".
//
// PART 4 RED LINE: the rendered HTML MUST contain the literal
// `minmax(0, 1fr)` inside the article-shell wrapper so a CSS-less
// snapshot still records the column contract for T11.AC3.
//
// PART 6 RED LINE: an Article with no FAQ blocks MUST NOT emit a
// FAQPage JSON-LD payload (T11.AC4). buildFaqJsonLd already returns ""
// for empty faqs[]; we only emit the `<script>` when the payload is
// non-empty.

import type { ArticleViewModel } from "../view-models/article";
import {
  renderAdSlot,
  renderCard,
  renderFooter,
  renderFloatingNext,
  renderHeader,
  renderNewsletter,
  type NavLink,
} from "./components";
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
} from "./seo";

export interface RenderArticleArgs {
  vm: ArticleViewModel;
  nav?: ReadonlyArray<NavLink>;
  footerLinks?: ReadonlyArray<NavLink>;
  legalLinks?: ReadonlyArray<NavLink>;
  newsletterHeading?: string;
  newsletterDescription?: string;
  newsletterProvider?: string | null;
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

function renderBreadcrumb(items: ReadonlyArray<{ name: string; url: string }>): string {
  if (items.length === 0) return "";
  const trail = items
    .map((item, i) => {
      const isLast = i === items.length - 1;
      const safeName = escText(item.name);
      if (isLast) {
        return `<li class="article-breadcrumb__item article-breadcrumb__item--current" aria-current="page">${safeName}</li>`;
      }
      return `<li class="article-breadcrumb__item"><a href="${escAttr(item.url)}">${safeName}</a></li>`;
    })
    .join("");
  return `<nav class="article-breadcrumb" aria-label="Breadcrumb"><ol>${trail}</ol></nav>`;
}

function renderArticleHero(article: ArticleViewModel["article"]): string {
  const heroImg =
    article.imageUrl !== null && article.imageUrl.length > 0
      ? `<img class="article-hero-img" src="${escAttr(article.imageUrl)}" alt="${escAttr(article.imageAlt ?? "")}" width="1200" height="630" loading="eager" decoding="async">`
      : "";
  const categoryHtml =
    article.categoryName.length > 0
      ? `<a class="article-cat" href="${escAttr(article.categoryHref)}">${escText(article.categoryName)}</a>`
      : "";
  const subtitleHtml =
    article.excerpt.length > 0
      ? `<p class="article-subtitle">${escText(article.excerpt)}</p>`
      : "";
  const metaParts: string[] = [];
  if (article.author !== null) {
    metaParts.push(`<span class="article-byline">${escText(article.author.name)}</span>`);
  }
  if (article.publishedAtDisplay.length > 0) {
    metaParts.push(`<time class="article-date" datetime="${escAttr(article.publishedAt)}">${escText(article.publishedAtDisplay)}</time>`);
  }
  if (article.readMinutesDisplay.length > 0) {
    metaParts.push(`<span class="article-meta-text">${escText(article.readMinutesDisplay)}</span>`);
  }
  const metaHtml =
    metaParts.length > 0 ? `<p class="article-meta">${metaParts.join("")}</p>` : "";
  return `<section class="article-hero" aria-labelledby="article-title">
  ${heroImg}
  <div class="article-hero-overlay"></div>
  <div class="article-hero-content">
    ${categoryHtml}
    <h1 id="article-title" class="article-title">${escText(article.title)}</h1>
    ${subtitleHtml}
  </div>
  ${metaHtml}
</section>`;
}

function renderBlockHtml(block: ArticleViewModel["article"]["body"][number]): string {
  switch (block.type) {
    case "html":
      return block.html.length > 0 ? `<div class="article-body__html">${block.html}</div>` : "";
    case "heading": {
      const tag = block.level === 3 ? "h3" : "h2";
      return `<${tag} class="article-body__heading">${escText(block.text)}</${tag}>`;
    }
    case "image": {
      const caption =
        block.caption !== null && block.caption.length > 0
          ? `<figcaption>${escText(block.caption)}</figcaption>`
          : "";
      return `<figure class="article-figure"><img src="${escAttr(block.src)}" alt="${escAttr(block.alt)}" width="1200" height="675" loading="lazy" decoding="async">${caption}</figure>`;
    }
    case "quote": {
      const cite =
        block.cite !== null && block.cite.length > 0
          ? `<cite>${escText(block.cite)}</cite>`
          : "";
      return `<blockquote class="pullquote">${escText(block.text)}${cite}</blockquote>`;
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((i) => `<li>${escText(i)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "code":
      return `<pre><code${block.language !== null ? ` class="language-${escAttr(block.language)}"` : ""}>${escText(block.code)}</code></pre>`;
    case "faq":
      return `<details class="article-body__faq"><summary>${escText(block.question)}</summary><div>${escText(block.answer)}</div></details>`;
  }
}

function renderArticleBody(article: ArticleViewModel["article"]): string {
  if (article.body.length === 0) return "";
  return article.body.map(renderBlockHtml).join("\n");
}

function renderSidebar(vm: ArticleViewModel): string {
  const tocItems = vm.article.body
    .filter((b) => b.type === "heading")
    .map((b, i) => `<li><a href="#article-heading-${i + 1}">${escText((b as { text: string }).text)}</a></li>`)
    .join("");
  const tocHtml =
    tocItems.length > 0
      ? `<aside class="sidebar-card toc"><h3>On this page</h3><ol>${tocItems}</ol></aside>`
      : "";
  const popularItems = vm.related
    .slice(0, 3)
    .map((c) => `<li><a href="${escAttr(c.href)}">${escText(c.title)}</a></li>`)
    .join("");
  const popularHtml =
    popularItems.length > 0
      ? `<aside class="sidebar-card sidebar-popular"><h3>Popular</h3><ol>${popularItems}</ol></aside>`
      : "";
  return `<aside class="article-sidebar">${tocHtml}${popularHtml}<aside class="sidebar-card sidebar-ad">${renderAdSlot({ type: "rect", slotId: "article-sidebar-ad", surface: "article" })}</aside></aside>`;
}

function renderShareRail(article: ArticleViewModel["article"]): string {
  const url = escAttr(`https://__SITE__${article.href}`);
  return `<aside class="share-rail" aria-label="Share this story">
  <button class="share-btn" type="button" data-share-action="copy" data-share-url="${url}" aria-label="Copy link">🔗</button>
  <button class="share-btn" type="button" data-share-action="native" data-share-url="${url}" aria-label="Share">↗</button>
  <p class="share-count" aria-hidden="true">0</p>
</aside>`;
}

function renderFaqSection(faqs: ArticleViewModel["faqs"]): string {
  if (faqs.length === 0) return "";
  const items = faqs
    .map(
      (f) =>
        `<details><summary>${escText(f.question)}</summary><div>${escText(f.answer)}</div></details>`,
    )
    .join("");
  return `<section class="faq-section" aria-labelledby="faq-heading"><h2 id="faq-heading">Frequently asked questions</h2>${items}</section>`;
}

function renderRelated(related: ArticleViewModel["related"]): string {
  if (related.length === 0) {
    return `<p class="related-section__empty">More stories coming soon.</p>`;
  }
  const cards = related
    .map(
      (c) =>
        `<li class="related-section__item">${renderCard({
          href: c.href,
          title: c.title,
          excerpt: c.excerpt,
          imageUrl: c.imageUrl,
          imageAlt: c.imageAlt,
          publishedAt: c.publishedAt,
          categoryName: c.categoryName,
          readMinutes: c.readMinutes,
        })}</li>`,
    )
    .join("");
  return `<h2 class="related-section__heading">Related stories</h2><ul class="related-section__list">${cards}</ul>`;
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

  const s1 = renderHeader({
    site: {
      name: site.name,
      tagline: site.tagline,
      logoUrl: site.logoUrl,
      hostname: site.hostname,
    },
    nav: args.nav,
  });

  const s2 = renderBreadcrumb(vm.breadcrumb);
  const s3 = renderArticleHero(article);
  const s4 = `<div class="reading-progress" aria-hidden="true"><div class="reading-progress-bar"></div></div>`;
  const s5 = renderAdSlot({ type: "leaderboard", slotId: "article-leaderboard", surface: "article" });

  // §6 — article-shell carries the literal minmax(0, 1fr) so the
  // CSS-less snapshot still records the column contract (T11.AC3).
  const s6 = `<div class="article-shell" data-grid="60px minmax(0, 1fr) 320px">
  ${renderShareRail(article)}
  <article class="article-body" id="article-content">
    ${renderArticleBody(article)}
  </article>
  ${renderSidebar(vm)}
</div>`;

  const s7 = renderFaqSection(vm.faqs);
  const s8 = renderAdSlot({ type: "in-feed", slotId: "article-in-feed", surface: "article" });
  const s9 = `<div class="article-share-bottom" aria-label="Share this story">
  <button class="share-btn" type="button" data-share-action="copy" aria-label="Copy link">Copy link</button>
  <button class="share-btn" type="button" data-share-action="native" aria-label="Share">Share</button>
</div>`;
  const s10 = `<section class="related-section" aria-labelledby="related-heading"><span id="related-heading" class="visually-hidden">Related stories</span>${renderRelated(vm.related)}</section>`;

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
  });
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
  // is non-empty (PART 6 RED LINE, T11.AC4 / T19.AC3).
  const jsonLdBlocks: string[] = [];
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
  const jsonLdHtml = renderJsonLdScripts(jsonLdBlocks);

  const sections = [
    `${marker(1, "site-header")}\n${s1}`,
    `${marker(2, "breadcrumb")}\n${s2}`,
    `${marker(3, "article-hero")}\n${s3}`,
    `${marker(4, "reading-progress")}\n${s4}`,
    `${marker(5, "ad-leaderboard")}\n${s5}`,
    `${marker(6, "article-shell")}\n${s6}`,
    `${marker(7, "faq-section")}\n${s7}`,
    `${marker(8, "ad-in-feed")}\n${s8}`,
    `${marker(9, "article-share-bottom")}\n${s9}`,
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
