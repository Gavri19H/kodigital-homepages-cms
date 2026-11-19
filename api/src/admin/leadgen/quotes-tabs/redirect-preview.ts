// F11 — the Templates preview of element "L · Redirect" (plan Section 3 G,
// Section 4): "Preview banner" / "Preview animation only" with a sample offer
// and a running countdown, inside the SAME canvas every other element uses
// (POST /variants/:id/preview — no new route).
//
// How: the canvas response already carries the funnel's composed page (its
// Theme, fonts, header and footer) and `config.design_tokens` (the effective
// design). The Templates island (quotes-tabs/templates.ts) resolves the draft
// "L · Redirect" block over those tokens and builds the redirect screen
// markup with the ES5 twins below, then drops it into the page's banners
// mount. The twins mirror redirect/look.ts resolveRedirectLook and
// redirect/screen.ts renderRedirectMarkup / redirectLookVarsCss and
// redirect/animations.ts renderCountdownAnimation; the parity is pinned
// byte-for-byte by test/leadgen-f11-templates.test.ts, so the preview can never
// drift from what visitors are served. The canvas iframe runs no script, so
// the island ticks the seconds from outside and the animation loops (CSS).
//
// The sample offer names no real partner (plan Section 5: nothing in code
// names a partner).

import { renderBanners, type BannerRenderCarrier } from "../../../public/leadgen/auction/banner";
import { getBannerDesign } from "../../../public/leadgen/designs/registry";
import {
  FRAME_REDIRECT_ANIMATIONS,
  FRAME_REDIRECT_CORNERS,
  FRAME_REDIRECT_TEXT_MAX,
  FRAME_SIZES,
} from "../../../public/leadgen/designs/frames";
import { FUNNEL_TOKEN_ROLES } from "../../../public/leadgen/designs/theme";
import {
  REDIRECT_HEADLINE_SIZES_PX,
  REDIRECT_LOOK_DEFAULTS,
  REDIRECT_NO_BRAND,
  REDIRECT_ONLY_ANIMATION_SIZE,
  REDIRECT_ONLY_HEADLINE_PX,
  REDIRECT_ROLE_TOKEN_PATHS,
  REDIRECT_ROUNDED_RADIUS,
} from "../../../public/leadgen/redirect/look";
import { markChosenCard, REDIRECT_SCREEN_CSS } from "../../../public/leadgen/redirect/screen";

// A neutral sample logo (no partner's mark): an inline SVG, fully
// percent-encoded so it carries no quote or angle bracket.
const SAMPLE_LOGO_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='60' viewBox='0 0 160 60'>" +
  "<rect x='1' y='1' width='158' height='58' rx='10' fill='#F2F4F7' stroke='#D0D5DD'/>" +
  "<circle cx='30' cy='30' r='13' fill='#98A2B3'/>" +
  "<text x='52' y='36' font-family='Arial,sans-serif' font-size='17' font-weight='700' fill='#475467'>Partner</text>" +
  "</svg>";
export const REDIRECT_PREVIEW_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(SAMPLE_LOGO_SVG)}`;
export const REDIRECT_PREVIEW_BRAND = "Sample Partner";
export const REDIRECT_PREVIEW_SECONDS = 5;

// The sample card: rendered by the REAL card renderer (auction/banner.ts) so it
// carries the Theme's real card styling; only its placeholder logo address is
// swapped for the inline sample logo.
function sampleCardsHtml(): string {
  const placeholderLogo = "https://preview.invalid/partner-logo.svg";
  const entry: BannerRenderCarrier = {
    carrier: {
      carrier_key: "sample-partner",
      carrier_name: REDIRECT_PREVIEW_BRAND,
      carrier_logo: placeholderLogo,
      headline: "It’s a match!",
      subheadline: "Tap below to continue on the partner’s site, where you’ll finish a few questions.",
      click_url: "https://preview.invalid/apply",
      bid: 1,
      bid_currency: "USD",
      tracking_id: null,
      disclaimer: null,
      pricing_model: null,
      carrier_key_source: "provider_id",
    },
    offer_public_id: "lgo_preview",
    slot: 1,
    source: "winner",
    bid: 1,
  };
  const out = renderBanners(
    [entry],
    { auction_instance_id: "preview", funnel_attempt_id: "preview" },
    { mode: "automatic" },
    getBannerDesign(null),
    { mintId: () => "preview" },
  );
  const marked = markChosenCard(out.html, { slot: 1, offer_public_id: "lgo_preview" });
  return (marked === null ? out.html : marked.html).split(placeholderLogo).join(REDIRECT_PREVIEW_LOGO_URL);
}

/** The data the island's preview twins read (embedded as `var RD = …`). */
export function redirectPreviewBoot(): Record<string, unknown> {
  return {
    css: REDIRECT_SCREEN_CSS,
    // Preview only: the canvas has no script, so the animations loop, the
    // sample card cannot be followed, and the question section steps aside.
    preview_css:
      "[data-lg-section]{display:none!important}" +
      ".lg-rd.lg-rd--loop{--lg-ra-turns:infinite}" +
      ".lg-rd--loop .lg-ra-prog,.lg-rd--loop .lg-ra-fill,.lg-rd--loop .lg-ra-logo{animation-iteration-count:infinite}" +
      ".lg-rd--loop .lg-banner{pointer-events:none}",
    defaults: REDIRECT_LOOK_DEFAULTS,
    role_paths: REDIRECT_ROLE_TOKEN_PATHS,
    roles: FUNNEL_TOKEN_ROLES,
    sizes: FRAME_SIZES,
    corners: FRAME_REDIRECT_CORNERS,
    animations: FRAME_REDIRECT_ANIMATIONS,
    text_max: FRAME_REDIRECT_TEXT_MAX,
    headline_px: REDIRECT_HEADLINE_SIZES_PX,
    only_headline_px: REDIRECT_ONLY_HEADLINE_PX,
    only_size: REDIRECT_ONLY_ANIMATION_SIZE,
    rounded: REDIRECT_ROUNDED_RADIUS,
    no_brand: REDIRECT_NO_BRAND,
    sample: {
      brand: REDIRECT_PREVIEW_BRAND,
      logo_url: REDIRECT_PREVIEW_LOGO_URL,
      seconds: REDIRECT_PREVIEW_SECONDS,
      cards_html: sampleCardsHtml(),
    },
  };
}

// The ES5 twins (old-style JavaScript: var/function only, no template
// literals or arrow functions). String.raw keeps every backslash exactly as
// the browser must see it. Each mirrors the named server function.
export const REDIRECT_PREVIEW_ISLAND_JS = String.raw`
  // Tags are spelt from parts so this island's text never carries an
  // unbalanced div token (the panel slicers count them).
  var RD_DIV_O = '<' + 'div';
  var RD_DIV_C = '<' + '/div>';
  var RD_TEXT_KEYS = ['badge_text', 'headline', 'message', 'countdown_line', 'stay_label', 'only_headline', 'only_message', 'only_link'];
  var RD_ROLE_SLOTS = [['background', 'background_role'], ['border', 'border_role'], ['badge', 'badge_role'], ['badge_bg', 'badge_bg_role'], ['headline', 'headline_role'], ['text', 'text_role'], ['animation', 'animation_role'], ['track', 'track_role']];
  function rdIsRecord(v) { return v !== null && typeof v === 'object' && !(v instanceof Array); }
  function rdEsc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // redirect/look.ts safeCss
  function rdSafeCss(v, fallback) {
    if (typeof v !== 'string') { return fallback; }
    var t = v.trim();
    if (t === '' || !/^[#\w\s.,%()'"\/+-]{1,200}$/.test(t) || /url\s*\(|expression|\\|\/\*/i.test(t)) { return fallback; }
    return t;
  }
  function rdRead(design, group, key) {
    var g = rdIsRecord(design) ? design[group] : undefined;
    return rdIsRecord(g) ? g[key] : undefined;
  }
  // designs/theme.ts baseTokenForRole
  function rdRoleValue(design, role) {
    var path = RD.role_paths[role] || '';
    var dot = path.indexOf('.');
    var v = dot < 0 ? undefined : rdRead(design, path.slice(0, dot), path.slice(dot + 1));
    return typeof v === 'string' ? v : '';
  }
  function rdPickText(s, key) {
    var v = s[key];
    var f = RD.defaults[key];
    if (typeof v !== 'string') { return f; }
    var t = v.trim();
    if (t === '' || t.length > RD.text_max) { return f; }
    if (key === 'countdown_line' && t.indexOf('{n}') < 0) { return f; }
    return t;
  }
  function rdPickEnum(s, key, values, fallback) {
    var v = s[key];
    return (typeof v === 'string' && values.indexOf(v) >= 0) ? v : fallback;
  }
  function rdPickBool(s, key) { return typeof s[key] === 'boolean' ? s[key] : RD.defaults[key]; }
  // redirect/look.ts resolveRedirectLook
  function rdResolveLook(stored, design) {
    var s = rdIsRecord(stored) ? stored : {};
    var D = RD.defaults;
    var look = { texts: {}, roles: {}, css: {} };
    var i, slot, v;
    for (i = 0; i < RD_ROLE_SLOTS.length; i++) {
      v = s[RD_ROLE_SLOTS[i][1]];
      look.roles[RD_ROLE_SLOTS[i][0]] = (typeof v === 'string' && RD.roles.indexOf(v) >= 0) ? v : D[RD_ROLE_SLOTS[i][1]];
    }
    for (i = 0; i < RD_TEXT_KEYS.length; i++) { look.texts[RD_TEXT_KEYS[i]] = rdPickText(s, RD_TEXT_KEYS[i]); }
    look.corners = rdPickEnum(s, 'corners', RD.corners, D.corners);
    look.shadow = rdPickBool(s, 'shadow');
    look.animation_size = rdPickEnum(s, 'animation_size', RD.sizes, D.animation_size);
    for (i = 0; i < RD_ROLE_SLOTS.length; i++) {
      slot = RD_ROLE_SLOTS[i][0];
      look.css[slot] = rdSafeCss(rdRoleValue(design, look.roles[slot]), slot === 'background' ? 'white' : 'currentColor');
    }
    look.css.radius = look.corners === 'square' ? '0px' : (look.corners === 'rounded' ? RD.rounded : rdSafeCss(rdRead(design, 'radius', 'lg'), '14px'));
    look.css.shadow = look.shadow ? rdSafeCss(rdRead(design, 'shadow', 'lg'), 'none') : 'none';
    look.css.font_headline = rdSafeCss(rdRead(design, 'headline', 'fontFamily'), 'inherit');
    look.css.font_body = rdSafeCss(rdRead(design, 'page', 'fontFamily'), 'inherit');
    look.badge_on = rdPickBool(s, 'badge_on');
    look.message_on = rdPickBool(s, 'message_on');
    look.show_seconds = rdPickBool(s, 'show_seconds');
    look.headline_size = rdPickEnum(s, 'headline_size', RD.sizes, D.headline_size);
    look.animation = rdPickEnum(s, 'animation', RD.animations, D.animation);
    return look;
  }
  // redirect/screen.ts redirectLookVarsCss
  function rdVarsCss(look, seconds) {
    var hs = RD.headline_px[look.headline_size];
    var c = look.css;
    return '.lg-rd{' +
      '--lg-rd-bg:' + c.background + ';--lg-rd-border:' + c.border + ';--lg-rd-badge:' + c.badge + ';--lg-rd-badge-bg:' + c.badge_bg + ';' +
      '--lg-rd-head:' + c.headline + ';--lg-rd-text:' + c.text + ';--lg-rd-radius:' + c.radius + ';--lg-rd-shadow:' + c.shadow + ';' +
      '--lg-rd-font-head:' + c.font_headline + ';--lg-rd-font-body:' + c.font_body + ';' +
      '--lg-rd-hs:' + hs[0] + 'px;--lg-rd-hs-sm:' + hs[1] + 'px;--lg-rd-only-hs:' + RD.only_headline_px[0] + 'px;--lg-rd-only-hs-sm:' + RD.only_headline_px[1] + 'px;' +
      '--lg-ra-color:' + c.animation + ';--lg-ra-track:' + c.track + ';--lg-ra-text:' + c.headline + ';' +
      '--lg-ra-secs:' + seconds + 's;--lg-ra-turns:' + seconds +
      '}';
  }
  // redirect/screen.ts fillRedirectText
  function rdFill(text, brand, seconds) {
    var name = (typeof brand === 'string' && brand.trim() !== '') ? brand.trim() : null;
    return rdEsc(text).replace(/\{brand\}|\{n\}/g, function (token, offset) {
      if (token === '{n}') { return '<span data-lg-rd-n>' + String(seconds) + '</span>'; }
      if (name !== null) { return rdEsc(name); }
      return offset === 0 ? RD.no_brand.charAt(0).toUpperCase() + RD.no_brand.slice(1) : RD.no_brand;
    });
  }
  // redirect/animations.ts isHttpLogoUrl (+ the preview's own inline sample logo)
  function rdIsLogo(u) {
    return typeof u === 'string' && (/^https?:\/\/[^\s"'<>]+$/i.test(u.trim()) || u.indexOf('data:image/svg+xml,') === 0);
  }
  // redirect/animations.ts renderCountdownAnimation
  function rdAnimation(style, size, showSeconds, seconds, logoUrl, logoAlt) {
    if (style === 'logo_bar' && !rdIsLogo(logoUrl)) { style = 'ring'; }
    if (RD.sizes.indexOf(size) < 0) { size = 'm'; }
    var cls = 'lg-ra lg-ra--' + style + ' lg-ra--' + size;
    var n = String(Math.max(0, Math.floor(seconds)));
    if (style === 'ring') {
      return RD_DIV_O + ' class="' + cls + '" aria-hidden="true">' +
        '<svg class="lg-ra-svg" viewBox="0 0 64 64" focusable="false">' +
        '<circle class="lg-ra-track" cx="32" cy="32" r="28"></circle>' +
        '<circle class="lg-ra-prog" cx="32" cy="32" r="28"></circle>' +
        '</svg>' + (showSeconds ? '<span class="lg-ra-n" data-lg-rd-n>' + n + '</span>' : '') + RD_DIV_C;
    }
    if (style === 'bar') {
      return RD_DIV_O + ' class="' + cls + '" aria-hidden="true">' +
        '<span class="lg-ra-bar"><span class="lg-ra-fill"></span></span>' +
        (showSeconds ? '<span class="lg-ra-n lg-ra-n--side" data-lg-rd-n>' + n + '</span>' : '') + RD_DIV_C;
    }
    if (style === 'logo_bar') {
      return RD_DIV_O + ' class="' + cls + '" aria-hidden="true">' +
        '<span class="lg-ra-lane"><span class="lg-ra-logo">' +
        '<img src="' + rdEsc(logoUrl.trim()) + '" alt="' + rdEsc(logoAlt === null || logoAlt === undefined ? '' : logoAlt) + '" />' +
        '</span></span>' +
        '<span class="lg-ra-bar"><span class="lg-ra-fill"></span></span>' + RD_DIV_C;
    }
    if (style === 'spinner') { return RD_DIV_O + ' class="' + cls + '" aria-hidden="true"><span class="lg-ra-spin"></span>' + RD_DIV_C; }
    return RD_DIV_O + ' class="' + cls + '" aria-hidden="true"><span class="lg-ra-dot"></span><span class="lg-ra-dot"></span><span class="lg-ra-dot"></span>' + RD_DIV_C;
  }
  // redirect/screen.ts renderRedirectMarkup
  function rdMarkup(m) {
    var look = m.look, t = look.texts, brand = m.brand, seconds = m.seconds;
    var only = m.display === 'animation';
    var size = only ? RD.only_size[look.animation_size] : look.animation_size;
    var anim = rdAnimation(look.animation, size, look.show_seconds, seconds, rdIsLogo(m.logo_url) ? m.logo_url : null, brand);
    var line = rdFill(t.countdown_line, brand, seconds);
    var open = RD_DIV_O + ' class="lg-rd ' + (only ? 'lg-rd--only' : 'lg-rd--banner') + '" data-lg-redirect' +
      ' data-lg-rd-display="' + (only ? 'animation' : 'banner') + '" data-lg-rd-seconds="' + seconds + '"' +
      ' data-lg-rd-slot="' + m.slot + '" data-lg-rd-brid="' + rdEsc(m.brid) + '" data-lg-rd-faid="' + rdEsc(m.faid) + '"' +
      ' data-lg-rd-hides="' + m.stay_mode + '" data-lg-rd-hides-key="' + rdEsc(m.stay_key) + '">' +
      '<style>' + RD.css + rdVarsCss(look, seconds) + '</style>' +
      RD_DIV_O + ' class="lg-rd-box">';
    var cards = RD_DIV_O + ' class="lg-rd-cards">' + m.cards_html + RD_DIV_C;
    function stay(label) { return '<button type="button" class="lg-rd-stay" data-lg-rd-stay>' + rdFill(label, brand, seconds) + '</button>'; }
    if (only) {
      return open + RD_DIV_O + ' class="lg-rd-chrome lg-rd-head">' +
        RD_DIV_O + ' class="lg-rd-anim">' + anim + RD_DIV_C +
        '<h2 class="lg-rd-headline lg-rd-headline--only">' + rdFill(t.only_headline, brand, seconds) + '</h2>' +
        '<p class="lg-rd-message">' + rdFill(t.only_message, brand, seconds) + '</p>' +
        '<p class="lg-rd-line lg-rd-sr" role="status">' + line + '</p>' +
        stay(t.only_link) + RD_DIV_C + cards + RD_DIV_C + RD_DIV_C;
    }
    return open + RD_DIV_O + ' class="lg-rd-chrome lg-rd-head">' +
      (look.badge_on ? '<span class="lg-rd-badge">' + rdFill(t.badge_text, brand, seconds) + '</span>' : '') +
      '<h2 class="lg-rd-headline">' + rdFill(t.headline, brand, seconds) + '</h2>' +
      (look.message_on ? '<p class="lg-rd-message">' + rdFill(t.message, brand, seconds) + '</p>' : '') +
      RD_DIV_O + ' class="lg-rd-anim">' + anim + RD_DIV_C +
      '<p class="lg-rd-line" role="status">' + line + '</p>' +
      RD_DIV_C + cards +
      RD_DIV_O + ' class="lg-rd-chrome lg-rd-foot">' + stay(t.stay_label) + RD_DIV_C +
      RD_DIV_C + RD_DIV_C;
  }
  // The preview: the sample offer's redirect screen dropped into the composed
  // page's banners mount, claimed (live, looping) the way the visitor page's
  // script would claim it.
  function rdPreviewHtml(pageHtml, display, stored, design) {
    var S = RD.sample;
    var markup = rdMarkup({
      display: display, look: rdResolveLook(stored, design), seconds: S.seconds, brand: S.brand,
      logo_url: S.logo_url, cards_html: S.cards_html, slot: 1, brid: 'preview', faid: '', stay_mode: 'none', stay_key: ''
    });
    markup = markup.replace(RD_DIV_O + ' class="lg-rd ', RD_DIV_O + ' class="lg-rd lg-rd--loop ')
      .replace(' data-lg-redirect', ' data-lg-redirect data-lg-rd-run="countdown" data-lg-rd-live');
    var mount = RD_DIV_O + ' class="lg-banners" data-lg-banners hidden>' + RD_DIV_C;
    var at = String(pageHtml).indexOf(mount);
    if (at < 0) { return String(pageHtml) + markup; }
    return pageHtml.slice(0, at) + RD_DIV_O + ' class="lg-banners" data-lg-banners>' + markup + RD_DIV_C + pageHtml.slice(at + mount.length);
  }
`;
