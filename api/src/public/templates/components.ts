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
import { iconArrow, iconBrandMark, iconChevronDown, iconPin, iconSearch } from "./icons";
import { responsiveImg } from "./responsive-img";
import {
  AD_SLOT_DIMENSIONS,
  renderAdSenseUnit,
  type AdsConfig,
  type AdSlotType,
} from "../ads";

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
  // T26: per-provider connection settings (Mailchimp audience id + account +
  // data-center, ConvertKit form id, Buttondown username, Substack handle, or
  // a custom action URL). When present and complete, renderNewsletter posts the
  // form to that provider's REAL hosted-form action instead of the generic
  // placeholder endpoint.
  config?: Readonly<Record<string, string>>;
  ctaLabel?: string;
}

// T26: the resolved per-provider hosted-form target. `action` is the real
// upstream form endpoint, `emailField` the field name that provider expects
// for the subscriber email, and `hidden` any extra hidden inputs the embed
// requires.
export interface NewsletterProviderForm {
  action: string;
  method: "post" | "get";
  emailField: string;
  hidden: ReadonlyArray<{ name: string; value: string }>;
}

// T26: map a configured provider + its connection settings to the provider's
// real hosted-form action. Returns null when the provider is unknown or its
// required connection fields are missing (caller then falls back to the
// generic enabled form so a provider-only selection is never a dead control).
export function buildNewsletterForm(
  provider: string | null | undefined,
  config: Readonly<Record<string, string>> | undefined,
): NewsletterProviderForm | null {
  const p = (provider ?? "").trim().toLowerCase();
  const cfg = config ?? {};
  const get = (k: string): string => {
    const v = cfg[k];
    return typeof v === "string" ? v.trim() : "";
  };
  switch (p) {
    case "mailchimp": {
      // Mailchimp embedded form: https://<dc>.list-manage.com/subscribe/post?u=<u>&id=<audience>
      const server = get("server");
      const account = get("account");
      const listId = get("list_id");
      if (server.length === 0 || account.length === 0 || listId.length === 0) return null;
      return {
        action: `https://${encodeURIComponent(server)}.list-manage.com/subscribe/post?u=${encodeURIComponent(account)}&id=${encodeURIComponent(listId)}`,
        method: "post",
        emailField: "EMAIL",
        hidden: [],
      };
    }
    case "convertkit": {
      const formId = get("form_id");
      if (formId.length === 0) return null;
      return {
        action: `https://app.convertkit.com/forms/${encodeURIComponent(formId)}/subscriptions`,
        method: "post",
        emailField: "email_address",
        hidden: [],
      };
    }
    case "buttondown": {
      const username = get("username");
      if (username.length === 0) return null;
      return {
        action: `https://buttondown.email/api/emails/embed-subscribe/${encodeURIComponent(username)}`,
        method: "post",
        emailField: "email",
        hidden: [{ name: "embed", value: "1" }],
      };
    }
    case "substack": {
      const handle = get("handle");
      if (handle.length === 0) return null;
      return {
        action: `https://${encodeURIComponent(handle)}.substack.com/api/v1/free`,
        method: "post",
        emailField: "email",
        hidden: [],
      };
    }
    case "custom": {
      // Operator supplies the full action URL. L-041: only https targets are
      // allowed so a misconfigured/compromised value cannot point at a
      // javascript:/data: scheme.
      const action = get("action");
      if (!action.startsWith("https://")) return null;
      const emailField = get("email_field");
      return {
        action,
        method: "post",
        emailField: emailField.length > 0 ? emailField : "email",
        hidden: [],
      };
    }
    default:
      return null;
  }
}

// T28: a resolved social-media link rendered in the footer. `platform` is the
// machine key (twitter/facebook/…) used for the `data-social` hook + the
// accessible label; `href` is the operator-supplied profile URL.
export interface SocialLink {
  platform: string;
  label: string;
  href: string;
}

// T28: the social platforms the operator can wire. `key` is the site_settings
// key (also the ALLOWED_SETTINGS_KEYS entry + the admin form field name); the
// order here is the footer render order. Twitter + Facebook are the AC pair;
// the rest round out the common set the legacy reference exposed.
export interface SocialPlatformDef {
  key: string;
  platform: string;
  label: string;
}

export const SOCIAL_PLATFORMS: ReadonlyArray<SocialPlatformDef> = [
  { key: "social_twitter_url", platform: "twitter", label: "Twitter" },
  { key: "social_facebook_url", platform: "facebook", label: "Facebook" },
  { key: "social_instagram_url", platform: "instagram", label: "Instagram" },
  { key: "social_linkedin_url", platform: "linkedin", label: "LinkedIn" },
  { key: "social_youtube_url", platform: "youtube", label: "YouTube" },
];

// Only http(s) profile URLs are ever turned into an href — a javascript:/data:
// value (or any other scheme) is dropped so a stored setting can never become
// a footer XSS vector (mirrors the custom-html.ts boundary discipline).
function isSafeSocialUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// buildSocialLinks — map a raw site_settings record onto the ordered footer
// links. Empty/whitespace/unsafe values contribute nothing, so the footer
// social nav only appears once at least one valid URL is set.
export function buildSocialLinks(
  settings: Readonly<Record<string, string>>,
): SocialLink[] {
  const out: SocialLink[] = [];
  for (const def of SOCIAL_PLATFORMS) {
    const raw = settings[def.key];
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    if (url.length === 0 || !isSafeSocialUrl(url)) continue;
    out.push({ platform: def.platform, label: def.label, href: url });
  }
  return out;
}

export interface FooterArgs {
  site: SiteRef;
  links?: ReadonlyArray<NavLink>;
  legalLinks?: ReadonlyArray<NavLink>;
  // T28: operator-set social-media profile links, rendered as a
  // `.site-footer__social` nav inside the design `.site-footer`.
  socialLinks?: ReadonlyArray<SocialLink>;
  copyrightYear?: number;
}

export interface AdSlotArgs {
  type: AdSlotType;
  slotId: string;
  surface?: string;
  // T22: when present + AdSense is live (provider + publisher id), the slot
  // emits its real <ins class="adsbygoogle"> unit. Omitted (or AdSense off) =
  // an empty reserved placeholder, exactly as before.
  ads?: AdsConfig;
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

// The site-name initial used for the brand-logo glyph — design `.brand-logo`
// is a 38px teal rounded square showing the site name's first letter (white,
// weight 900, 20px), NOT the uploaded logo image. RESCUE-4 user RED LINE: the
// uploaded (bad-AI) logo MUST NOT render in the header; the teal-square initial
// mark replaces it. Sourced from the view-model site name (never hardcoded).
function brandInitial(name: string): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "•";
}

export function renderHeader(args: HeaderArgs): string {
  const site = args.site;
  const placeholder = searchPlaceholderOf(args.searchPlaceholder);
  // Design brand mark: a teal rounded-square with the site-name initial — NOT
  // the uploaded logo <img> (the live header wrongly rendered the AI logo).
  const logoHtml = `<span class="brand-logo" aria-hidden="true">${escText(brandInitial(site.name))}</span>`;
  // Design header child order: .brand → .header-search → .header-nav
  // (4 nav-links, the first with a chevron, then a .btn-outline "Sign in").
  // Each nav label is wrapped in <span class="label"> so the 880px breakpoint
  // can hide the text (design `.nav-link span.label { display:none }`).
  const nav = args.nav !== undefined && args.nav.length > 0 ? args.nav : CONTRACT_NAV;
  const navLinks = nav
    .map((n, i) => {
      const current = n.active === true ? ' aria-current="page"' : "";
      const chevron = i === 0 ? iconChevronDown({ className: "nav-chevron", size: 12 }) : "";
      return `<a class="nav-link" href="${escAttr(n.href)}"${current}><span class="label">${escText(n.label)}</span>${chevron}</a>`;
    })
    .join("");
  return `<header class="site-header" role="banner">
  <div class="container">
    <div class="header-inner">
      <a class="brand" href="/" aria-label="${escAttr(site.name)} home">${logoHtml}<span class="brand-name">${escText(site.name)}</span></a>
      <div class="header-search" role="search">${iconSearch({ size: 16 })}<input type="search" name="q" aria-label="Search" placeholder="${escAttr(placeholder)}"></div>
      <nav class="header-nav" aria-label="Primary">${navLinks}<button class="btn-outline" type="button">Sign in</button></nav>
    </div>
  </div>
</header>`;
}

export function renderHero(args: HeroArgs): string {
  const placeholder = searchPlaceholderOf(args.searchPlaceholder);
  // Design hero DOM: .hero > .hero-bg + .hero-content > h1.hero-title
  // (title + literal period) > span.tagline, then form.hero-search.
  //
  // RESCUE-4 RED LINE: .hero-bg is a PURE CSS gradient (no <img>, design has no
  // hero photo). When the operator set a real site hero image (args.imageUrl, a
  // /media/<key>) it overrides the gradient via an inline background-image —
  // still NO <img>. The lead-article image is NEVER used as the hero bg (the
  // design does not), so a bare gradient hero is correct when no site hero is
  // set. The tagline rides INSIDE the h1; there is no kicker and the title is
  // not a link (the hero is the site identity, not a story).
  const bgStyle =
    args.imageUrl !== undefined && args.imageUrl !== null && args.imageUrl.length > 0
      ? ` style="background-image:url(${escAttr(args.imageUrl)})"`
      : "";
  const taglineHtml =
    args.excerpt !== undefined && args.excerpt.length > 0
      ? `<span class="tagline">${escText(args.excerpt)}</span>`
      : "";
  return `<section class="hero" aria-label="Featured story">
  <div class="hero-bg" aria-hidden="true"${bgStyle}></div>
  <div class="hero-content">
    <h1 class="hero-title">${escText(args.title)}.${taglineHtml}</h1>
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
      // Design `.cat-chip-img` is a 48×48 thumbnail on the LEFT. The worker
      // categories have no image URL → render the design `Ph` gradient
      // placeholder (a .ph div with the category name as its data-label),
      // EXACTLY like the design's <Ph>. If a chip does carry an imageUrl, use a
      // real bare /media/ <img> instead (no /cdn-cgi transform).
      const inner =
        chip.imageUrl !== undefined && chip.imageUrl !== null && chip.imageUrl.length > 0
          ? imgTag(chip.imageUrl, chip.imageAlt ?? name, ' width="48" height="48" loading="lazy" decoding="async"')
          : `<div class="ph" data-label="${escAttr(name)}" style="--ph-a:#c8d8e8;--ph-b:#1ba8c8"></div>`;
      return `<a class="cat-chip" href="${escAttr(href)}"><span class="cat-chip-img">${inner}</span><span class="cat-chip-label">${escText(name)}</span></a>`;
    })
    .join("");
  // Design ChipRail DOM: .cat-rail > .cat-rail-scroll > a.cat-chip+ , then the
  // .cat-rail-arrow "next" affordance. (<nav> root keeps the a11y landmark the
  // worker has always used — the design's outer is a bare section.)
  return `<nav class="cat-rail" aria-label="${escAttr(label)}"><div class="cat-rail-scroll">${items}</div><button class="cat-rail-arrow" type="button" aria-label="Scroll categories">${iconArrow({ className: "cat-rail-arrow-icon", size: 18 })}</button></nav>`;
}

export function renderCard(args: CardArgs): string {
  const href = args.href.length > 0 ? args.href : "";
  // Design Card DOM: a.card > .card-img (img|.ph + .card-pin) + .card-body
  // (h3.card-title + .card-foot > span.card-byline). The whole card IS the
  // anchor. card-img is the 16/11 treatment; the image is a bare /media/ <img>
  // (T21 — Cloudflare Image Resizing is OFF, so NO /cdn-cgi srcset), or the
  // design `.ph` gradient placeholder when no image is set. Below-fold → lazy.
  const realImg = responsiveImg({
    src: args.imageUrl,
    alt: args.imageAlt,
    width: 640,
    height: 440,
    loading: "lazy",
    sizes: "(max-width: 560px) 100vw, (max-width: 1080px) 50vw, 25vw",
  });
  const imgInner =
    realImg.length > 0
      ? realImg
      : `<div class="ph" data-label="${escAttr(args.categoryName ?? args.title ?? "")}" style="--ph-a:#c8d8e8;--ph-b:#1ba8c8"></div>`;
  // Design card-foot byline = "{categoryName} · {publishedAt}" (Spotlight/Latest
  // cards use exactly this; no avatar — the worker VM carries no author/avatar).
  const bylineParts: string[] = [];
  if (args.categoryName !== undefined && args.categoryName.length > 0) {
    bylineParts.push(escText(args.categoryName));
  }
  if (args.publishedAt !== undefined && args.publishedAt.length > 0) {
    bylineParts.push(escText(args.publishedAt));
  }
  const footHtml =
    bylineParts.length > 0
      ? `<div class="card-foot"><span class="card-byline">${bylineParts.join(" · ")}</span></div>`
      : "";
  return `<a class="card" href="${escAttr(href)}">
  <div class="card-img">${imgInner}<span class="card-pin" aria-hidden="true">${iconPin({ className: "card-pin-icon", size: 14 })}</span></div>
  <div class="card-body">
    <h3 class="card-title">${escText(args.title)}</h3>
    ${footHtml}
  </div>
</a>`;
}

export function renderNewsletter(args: NewsletterArgs): string {
  const ctaLabel = args.ctaLabel !== undefined && args.ctaLabel.length > 0 ? args.ctaLabel : "Subscribe";
  const descriptionHtml =
    args.description !== undefined && args.description.length > 0
      ? `<p class="newsletter__description">${escText(args.description)}</p>`
      : "";
  // §11 / PART 11: a section with NO provider selected is a disabled stub
  // (the live submit is forbidden until an operator picks a provider).
  const disabled = args.provider === null || args.provider === undefined || args.provider.length === 0;
  const disabledAttr = disabled ? ' disabled aria-disabled="true"' : "";
  const noticeHtml = disabled
    ? `<p class="newsletter__notice" role="status">Newsletter signup will open soon.</p>`
    : "";

  // T26: when the chosen provider has complete connection settings, post to its
  // REAL hosted-form action; otherwise (provider chosen but not yet connected)
  // fall back to the explicit formAction / generic endpoint so the control
  // still works and switching provider changes the action.
  const providerForm = disabled ? null : buildNewsletterForm(args.provider, args.config);
  const action =
    providerForm !== null
      ? providerForm.action
      : args.formAction !== undefined && args.formAction.length > 0
        ? args.formAction
        : "/api/newsletter/subscribe";
  const method = providerForm !== null ? providerForm.method : "post";
  const emailField = providerForm !== null ? providerForm.emailField : "email";
  const hiddenHtml =
    providerForm === null
      ? ""
      : providerForm.hidden
          .map((h) => `<input type="hidden" name="${escAttr(h.name)}" value="${escAttr(h.value)}">`)
          .join("");

  // Design Newsletter DOM: `.container > .newsletter` (a two-column brand-tint
  // card). The outer section keeps the #newsletter anchor target + a11y label;
  // the .newsletter card carries the BEM hooks (copy + form + disabled state).
  return `<section class="container" id="newsletter" aria-labelledby="newsletter-heading">
  <div class="newsletter">
    <div class="newsletter__copy">
      <h2 id="newsletter-heading" class="newsletter__heading">${escText(args.heading)}</h2>
      ${descriptionHtml}
    </div>
    <div class="newsletter__action">
      <form class="newsletter__form" method="${escAttr(method)}" action="${escAttr(action)}">
        <label class="newsletter__label newsletter-label-sr" for="newsletter-email">Email address</label>
        <input class="newsletter__input" id="newsletter-email" name="${escAttr(emailField)}" type="email" autocomplete="email" required${disabledAttr}>
        ${hiddenHtml}
        <button class="newsletter__cta" type="submit"${disabledAttr}>${escText(ctaLabel)}</button>
      </form>
      ${noticeHtml}
    </div>
  </div>
</section>`;
}

// RESCUE-4 FOOTER FIX: the live footer was only the brand name + copyright — no
// site description, no link columns. The design footer (contract §7 §12) is a
// 4-column grid: a brand block (logo + name + description + social) then three
// link columns. These default columns use REAL hrefs (home, in-page section
// anchors that exist — #featured/#trending/#picks/#latest/#newsletter — plus
// /feed.xml + /sitemap.xml; PART 8 forbids href="#"). An operator-supplied
// args.links overrides the first column.
const FOOTER_COLUMNS: ReadonlyArray<{ heading: string; links: ReadonlyArray<NavLink> }> = [
  {
    heading: "Explore",
    links: [
      { label: "Home", href: "/" },
      { label: "Featured", href: "/#featured" },
      { label: "Trending", href: "/#trending" },
      { label: "Editor's Picks", href: "/#picks" },
    ],
  },
  {
    heading: "Read",
    links: [
      { label: "Latest", href: "/#latest" },
      { label: "Newsletter", href: "/#newsletter" },
    ],
  },
  {
    heading: "Follow",
    links: [
      { label: "RSS Feed", href: "/feed.xml" },
      { label: "Sitemap", href: "/sitemap.xml" },
    ],
  },
];

export function renderFooter(args: FooterArgs): string {
  const site = args.site;
  const year = args.copyrightYear ?? new Date().getUTCFullYear();
  const tagline =
    site.tagline !== undefined && site.tagline.length > 0 ? site.tagline : "";
  const description =
    tagline.length > 0 ? tagline : "Stories, guides, and ideas — published daily.";
  // Design footer brand mark = the same teal-square initial as the header
  // (RESCUE-4: the uploaded logo is NEVER rendered). Sourced from site.name.
  const logoHtml = `<span class="brand-logo" aria-hidden="true">${escText(brandInitial(site.name))}</span>`;
  // Design footer-top columns: an operator-supplied args.links overrides the
  // first column; the rest keep the real-href Explore/Read/Follow defaults.
  const columns =
    args.links !== undefined && args.links.length > 0
      ? [{ heading: "Explore", links: args.links }, ...FOOTER_COLUMNS.slice(1)]
      : FOOTER_COLUMNS;
  // Design `.footer-col` (h4 + ul). Hook class `site-footer__col` retained for
  // the rescue regression (home-render-fidelity D4).
  const colsHtml = columns
    .map(
      (col) =>
        `<nav class="footer-col site-footer__col" aria-label="${escAttr(col.heading)}"><h4>${escText(col.heading)}</h4><ul>${col.links
          .map((n) => `<li><a href="${escAttr(n.href)}">${escText(n.label)}</a></li>`)
          .join("")}</ul></nav>`,
    )
    .join("");
  const legalLinks = args.legalLinks ?? [];
  const legalNavHtml =
    legalLinks.length === 0
      ? ""
      : `<nav class="site-footer__legal" aria-label="Legal"><ul>${legalLinks
          .map((n) => `<li><a href="${escAttr(n.href)}">${escText(n.label)}</a></li>`)
          .join("")}</ul></nav>`;
  // T28: operator-set social profile links — only rendered when the operator
  // has set at least one (buildSocialLinks dropped empty/unsafe values). The
  // nav class stays EXACTLY `site-footer__social` (social-links.test.ts asserts
  // the literal); CSS styles it as the design `.footer-social` pill row. These
  // are the data-driven equivalent of the design's hardcoded social icons.
  const socialLinks = args.socialLinks ?? [];
  const socialNavHtml =
    socialLinks.length === 0
      ? ""
      : `<nav class="site-footer__social" aria-label="Social media"><ul>${socialLinks
          .map(
            (s) =>
              `<li><a class="site-footer__social-link" data-social="${escAttr(s.platform)}" href="${escAttr(s.href)}" target="_blank" rel="noopener noreferrer me">${escText(s.label)}</a></li>`,
          )
          .join("")}</ul></nav>`;
  // Design footer bottom copyright line: "© {year} {name} — {tagline}". The
  // site name sits as the span's DIRECT text (no nested element before it) so
  // the brand-from-site regression's `site-footer__copyright[^<]*<name>` match
  // holds.
  const copyrightText =
    tagline.length > 0
      ? `© ${year} ${escText(site.name)} — ${escText(tagline)}`
      : `© ${year} ${escText(site.name)}`;
  return `<footer class="site-footer" role="contentinfo">
  <div class="container">
    <div class="footer-top">
      <div class="footer-brand site-footer__brand-col">
        <a class="brand" href="/" aria-label="${escAttr(site.name)} home">${logoHtml}<span class="brand-name site-footer__brand">${escText(site.name)}</span></a>
        <p class="site-footer__description">${escText(description)}</p>
      </div>
      ${colsHtml}
    </div>
    ${legalNavHtml}
    <div class="footer-bottom">
      <span class="footer-copyright site-footer__copyright">${copyrightText}</span>
      ${socialNavHtml}
    </div>
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
  // T22: design-doc reserved dimensions (970×90 leaderboard, 728×90 in-feed,
  // 300×250 rect). The box is held open before the ad library injects — both
  // inline AND via data-w/data-h so a deferred stylesheet can never collapse
  // it (no CLS). When AdSense is live the slot carries its real <ins> unit;
  // otherwise it stays an empty reserved placeholder.
  const dims = AD_SLOT_DIMENSIONS[args.type];
  // RESCUE-4 overflow fix: reserve the ad HEIGHT (anti-CLS) but never force a
  // fixed pixel WIDTH — width:970px;min-width:970px on the leaderboard overflowed
  // the 375px mobile viewport (horizontal scroll). Cap at the ad's intrinsic
  // width, shrink to the container below it.
  const dimStyle =
    `max-width:${dims.width}px;width:100%;` +
    `min-height:${dims.height}px;height:${dims.height}px`;
  const unit =
    args.ads !== undefined ? renderAdSenseUnit(args.ads, args.type) : "";
  // Design Ad DOM: the slot is centred inside a `.container`. The element stays
  // an <aside> (the public-ad-slots regression extracts ad-slots as <aside> and
  // requires the a11y label) carrying the `.ad-slot.ad-slot--<type>` design
  // classes + the anti-CLS inline dims (D5: max-width, never a fixed width).
  return (
    `<div class="container">` +
    `<aside class="ad-slot ad-slot--${adType}" data-ad-slot="${slotId}" ` +
    `data-ad-type="${adType}"${surfaceAttr} style="${dimStyle}" ` +
    `data-w="${dims.width}" data-h="${dims.height}" ` +
    `aria-label="Advertisement">${unit}</aside>` +
    `</div>`
  );
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
