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

  return `<section class="newsletter" id="newsletter" aria-labelledby="newsletter-heading">
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
  // T28: social profile links — only rendered when the operator has set at
  // least one (buildSocialLinks already dropped empty/unsafe values). Each
  // anchor opens in a new tab with rel="noopener noreferrer me" and carries a
  // data-social hook so a deferred stylesheet can paint platform glyphs.
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
  return `<footer class="site-footer" role="contentinfo">
  <div class="site-footer__inner">
    <p class="site-footer__brand">${escText(site.name)}</p>
    ${primaryNavHtml}
    ${legalNavHtml}
    ${socialNavHtml}
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
  // T22: design-doc reserved dimensions (970×90 leaderboard, 728×90 in-feed,
  // 300×250 rect). The box is held open before the ad library injects — both
  // inline AND via data-w/data-h so a deferred stylesheet can never collapse
  // it (no CLS). When AdSense is live the slot carries its real <ins> unit;
  // otherwise it stays an empty reserved placeholder.
  const dims = AD_SLOT_DIMENSIONS[args.type];
  const dimStyle =
    `min-width:${dims.width}px;min-height:${dims.height}px;` +
    `width:${dims.width}px;height:${dims.height}px`;
  const unit =
    args.ads !== undefined ? renderAdSenseUnit(args.ads, args.type) : "";
  return (
    `<aside class="ad-slot ad-slot--${adType}" data-ad-slot="${slotId}" ` +
    `data-ad-type="${adType}"${surfaceAttr} style="${dimStyle}" ` +
    `data-w="${dims.width}" data-h="${dims.height}" ` +
    `aria-label="Advertisement">${unit}</aside>`
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
