// F11 — the redirect banner / animation-only screen (plan Section 3 D, G, H;
// Section 4). Built on the SERVER into the results the auction returns; the
// funnel page shell's small redirect script (./page-script.ts) runs it.
//
// serve-auction.ts calls, only when the engine returned an instruction:
//   const look = await loadRedirectLook(c.env, resolved);   // never throws to the caller
//   banners_html = renderRedirectScreen({ banners_html, instruction, look });
//
// What the markup does (and does not do):
//   * It WRAPS the normal cards, unchanged — the chosen card keeps its own
//     <a class="lg-banner" href="/lg/lc/…">; the only addition is a
//     data-lg-rd-chosen marker on that one card's tag. No link is rewritten.
//   * It is INERT until the page script claims it (data-lg-rd-live): with no
//     script (an old cached shell) the visitor sees exactly today's results
//     page. While live, CSS hides every other card (display:none — never on
//     screen, so the ≥50%-for-1s view rule never counts them) and, on the
//     animation-only screen, the chosen card too.
//   * It carries what the page script needs as data attributes: seconds,
//     display, slot, the chosen card's own brid and faid, and what "Stay here"
//     hides. None of them uses the data-slot / data-lg-slot names the visitor
//     bundle's viewability lookup keys on (runtime/auction-client.ts slotTarget).
//   * Every operator text is escaped; {brand} / {n} are the only fill-ins.
//
// The stylesheet rides inside the markup (one <style> at the top), so the
// funnel shell's own stylesheet stays byte-identical to the admin preview's
// (the parity the preview/serve tests pin) and pages with no redirect carry
// none of it.

import type { RedirectAfterInstruction } from "./types";
import type { resolveActivatedFunnelByVariant } from "../resolver";
import { resolveSavedFrameTemplateDefaultsFor } from "../resolver";
import { getFunnelDesign } from "../designs/registry";
import { frameSourceOf, resolveFrameComposition, resolveThemeRecordFor } from "../serve";
import type { Env } from "../../../env";
import {
  COUNTDOWN_ANIMATION_CSS,
  effectiveAnimationStyle,
  isHttpLogoUrl,
  renderCountdownAnimation,
} from "./animations";
import {
  REDIRECT_HEADLINE_SIZES_PX,
  REDIRECT_NO_BRAND,
  REDIRECT_ONLY_ANIMATION_SIZE,
  REDIRECT_ONLY_HEADLINE_PX,
  resolveRedirectLook,
  type RedirectLook,
} from "./look";

export type { RedirectLook } from "./look";

export type ResolvedFunnelForRedirect = NonNullable<Awaited<ReturnType<typeof resolveActivatedFunnelByVariant>>>;

// ---------------------------------------------------------------------------
// loadRedirectLook — the effective Template's "L · Redirect" block merged over
// the defaults, with the funnel Theme's roles and fonts. The SAME composition
// the funnel shell renders with (serve.ts resolveFrameComposition: saved
// template ⊕ funnel frame ⊕ variant overrides; theme record ⊕ inline theme ⊕
// variant palette). Never throws: any failure is null, and the renderer then
// uses the defaults over the base design.
// ---------------------------------------------------------------------------

export async function loadRedirectLook(
  env: unknown,
  resolved: ResolvedFunnelForRedirect,
): Promise<RedirectLook | null> {
  try {
    const e = env as Env;
    const savedTemplateDefaults = await resolveSavedFrameTemplateDefaultsFor(e.DB, resolved);
    const source = frameSourceOf(resolved, savedTemplateDefaults);
    const themeRecord = await resolveThemeRecordFor(e, source);
    const design = getFunnelDesign(resolved.variant.funnel_design_id);
    const composition = resolveFrameComposition(source, design, themeRecord);
    const effectiveDesign = composition === null ? design : composition.effectiveTokens.design;
    const stored = composition === null ? null : (composition.frame.redirect ?? null);
    return resolveRedirectLook(stored, effectiveDesign);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The stylesheet (static) + the per-look custom properties.
// ---------------------------------------------------------------------------

export const REDIRECT_SCREEN_CSS =
  ".lg-rd{display:block;width:100%;box-sizing:border-box}" +
  ".lg-rd .lg-rd-chrome{display:none}" +
  ".lg-rd[data-lg-rd-live] .lg-rd-head{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px}" +
  ".lg-rd[data-lg-rd-live] .lg-rd-foot{display:flex;justify-content:center}" +
  ".lg-rd--banner[data-lg-rd-live] .lg-rd-box{display:flex;flex-direction:column;gap:16px;max-width:520px;margin:0 auto;padding:26px 22px 18px;box-sizing:border-box;background:var(--lg-rd-bg);border:1px solid var(--lg-rd-border);border-radius:var(--lg-rd-radius);box-shadow:var(--lg-rd-shadow);font-family:var(--lg-rd-font-body)}" +
  ".lg-rd--banner[data-lg-rd-live] .lg-banner:not([data-lg-rd-chosen]){display:none!important}" +
  ".lg-rd--banner[data-lg-rd-live] .lg-rd-cards .lg-banners{margin:0 auto;max-width:100%}" +
  ".lg-rd--only[data-lg-rd-live] .lg-rd-cards{display:none!important}" +
  ".lg-rd--only[data-lg-rd-live] .lg-rd-box{padding:40px 0 24px;font-family:var(--lg-rd-font-body)}" +
  ".lg-rd--only[data-lg-rd-live] .lg-rd-head{gap:14px}" +
  ".lg-rd .lg-banner[data-lg-rd-hide]{display:none!important}" +
  ".lg-rd-badge{display:inline-block;font-family:var(--lg-rd-font-body);font-size:12px;font-weight:600;line-height:1;text-transform:uppercase;letter-spacing:.08em;color:var(--lg-rd-badge);background:var(--lg-rd-badge-bg);border-radius:999px;padding:6px 12px}" +
  ".lg-rd-headline{margin:0;font-family:var(--lg-rd-font-head);font-size:var(--lg-rd-hs);font-weight:600;line-height:1.2;color:var(--lg-rd-head)}" +
  ".lg-rd-headline--only{font-size:var(--lg-rd-only-hs)}" +
  ".lg-rd-message{margin:0;font-family:var(--lg-rd-font-body);font-size:15px;font-weight:400;line-height:1.5;color:var(--lg-rd-text)}" +
  ".lg-rd-line{margin:0;font-family:var(--lg-rd-font-body);font-size:14px;font-weight:500;line-height:1.4;color:var(--lg-rd-text)}" +
  ".lg-rd-anim{display:flex;justify-content:center;width:100%;margin:4px 0}" +
  ".lg-rd-stay{-webkit-appearance:none;appearance:none;background:none;border:0;margin:0;padding:6px 8px;font-family:var(--lg-rd-font-body);font-size:14px;line-height:1.4;color:var(--lg-rd-text);text-decoration:underline;cursor:pointer}" +
  ".lg-rd-stay:focus-visible{outline:2px solid var(--lg-ra-color);outline-offset:2px;border-radius:4px}" +
  ".lg-rd-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}" +
  // A visitor's own click stopped the countdown: the numbers stop meaning anything.
  '.lg-rd[data-lg-rd-run="clicked"] .lg-rd-anim,.lg-rd[data-lg-rd-run="clicked"] .lg-rd-line{display:none}' +
  "@media (max-width:480px){" +
  ".lg-rd--banner[data-lg-rd-live] .lg-rd-box{padding:22px 18px}" +
  ".lg-rd-headline{font-size:var(--lg-rd-hs-sm)}" +
  ".lg-rd-headline--only{font-size:var(--lg-rd-only-hs-sm)}" +
  "}" +
  COUNTDOWN_ANIMATION_CSS;

/** The look's custom properties, scoped to the screen (one per page). */
export function redirectLookVarsCss(look: RedirectLook, seconds: number): string {
  const [hs, hsSm] = REDIRECT_HEADLINE_SIZES_PX[look.headline_size];
  const [ohs, ohsSm] = REDIRECT_ONLY_HEADLINE_PX;
  const c = look.css;
  return (
    ".lg-rd{" +
    `--lg-rd-bg:${c.background};--lg-rd-border:${c.border};--lg-rd-badge:${c.badge};--lg-rd-badge-bg:${c.badge_bg};` +
    `--lg-rd-head:${c.headline};--lg-rd-text:${c.text};--lg-rd-radius:${c.radius};--lg-rd-shadow:${c.shadow};` +
    `--lg-rd-font-head:${c.font_headline};--lg-rd-font-body:${c.font_body};` +
    `--lg-rd-hs:${hs}px;--lg-rd-hs-sm:${hsSm}px;--lg-rd-only-hs:${ohs}px;--lg-rd-only-hs-sm:${ohsSm}px;` +
    `--lg-ra-color:${c.animation};--lg-ra-track:${c.track};--lg-ra-text:${c.headline};` +
    `--lg-ra-secs:${seconds}s;--lg-ra-turns:${seconds}` +
    "}"
  );
}

// ---------------------------------------------------------------------------
// Fill-ins. Operator text is escaped first, THEN {brand} / {n} are replaced
// with markup we build (the escaped brand / the live seconds span), so no
// operator character ever becomes markup.
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fillRedirectText(text: string, brand: string | null, seconds: number): string {
  const name = brand !== null && brand.trim() !== "" ? brand.trim() : null;
  // ONE pass over the escaped text, so a brand that itself reads "{n}" stays text.
  return esc(text).replace(/\{brand\}|\{n\}/g, (token: string, offset: number) => {
    if (token === "{n}") return `<span data-lg-rd-n>${String(seconds)}</span>`;
    if (name !== null) return esc(name);
    // "{brand} will help you…" with no brand reads "Your offer will help you…".
    return offset === 0 ? capitalise(REDIRECT_NO_BRAND) : REDIRECT_NO_BRAND;
  });
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// The markup (pure). The admin Templates preview builds the same string
// client-side (quotes-tabs/templates.ts), pinned byte-for-byte by
// test/leadgen-f11-templates.test.ts.
// ---------------------------------------------------------------------------

export interface RedirectMarkupInput {
  display: "banner" | "animation";
  look: RedirectLook;
  seconds: number;
  brand: string | null;
  logo_url: string | null;
  /** The auction's cards, the chosen one already marked data-lg-rd-chosen. */
  cards_html: string;
  slot: number;
  brid: string;
  faid: string;
  stay_mode: "none" | "offer" | "carrier";
  stay_key: string;
}

export function renderRedirectMarkup(input: RedirectMarkupInput): string {
  const { look, seconds, brand } = input;
  const only = input.display === "animation";
  const t = look.texts;
  const size = only ? REDIRECT_ONLY_ANIMATION_SIZE[look.animation_size] : look.animation_size;
  const anim = renderCountdownAnimation({
    style: effectiveAnimationStyle(look.animation, input.logo_url),
    size,
    show_seconds: look.show_seconds,
    seconds,
    logo_url: isHttpLogoUrl(input.logo_url) ? input.logo_url : null,
    logo_alt: brand,
  });
  const line = fillRedirectText(t.countdown_line, brand, seconds);
  const open =
    `<div class="lg-rd ${only ? "lg-rd--only" : "lg-rd--banner"}" data-lg-redirect` +
    ` data-lg-rd-display="${only ? "animation" : "banner"}" data-lg-rd-seconds="${seconds}"` +
    ` data-lg-rd-slot="${input.slot}" data-lg-rd-brid="${esc(input.brid)}" data-lg-rd-faid="${esc(input.faid)}"` +
    ` data-lg-rd-hides="${input.stay_mode}" data-lg-rd-hides-key="${esc(input.stay_key)}">` +
    `<style>${REDIRECT_SCREEN_CSS}${redirectLookVarsCss(look, seconds)}</style>` +
    `<div class="lg-rd-box">`;
  const stay = (label: string): string =>
    `<button type="button" class="lg-rd-stay" data-lg-rd-stay>${fillRedirectText(label, brand, seconds)}</button>`;
  const cards = `<div class="lg-rd-cards">${input.cards_html}</div>`;
  if (only) {
    return (
      open +
      `<div class="lg-rd-chrome lg-rd-head">` +
      `<div class="lg-rd-anim">${anim}</div>` +
      `<h2 class="lg-rd-headline lg-rd-headline--only">${fillRedirectText(t.only_headline, brand, seconds)}</h2>` +
      `<p class="lg-rd-message">${fillRedirectText(t.only_message, brand, seconds)}</p>` +
      `<p class="lg-rd-line lg-rd-sr" role="status">${line}</p>` +
      stay(t.only_link) +
      `</div>` +
      cards +
      `</div></div>`
    );
  }
  return (
    open +
    `<div class="lg-rd-chrome lg-rd-head">` +
    (look.badge_on ? `<span class="lg-rd-badge">${fillRedirectText(t.badge_text, brand, seconds)}</span>` : "") +
    `<h2 class="lg-rd-headline">${fillRedirectText(t.headline, brand, seconds)}</h2>` +
    (look.message_on ? `<p class="lg-rd-message">${fillRedirectText(t.message, brand, seconds)}</p>` : "") +
    `<div class="lg-rd-anim">${anim}</div>` +
    `<p class="lg-rd-line" role="status">${line}</p>` +
    `</div>` +
    cards +
    `<div class="lg-rd-chrome lg-rd-foot">${stay(t.stay_label)}</div>` +
    `</div></div>`
  );
}

// ---------------------------------------------------------------------------
// Finding and marking the chosen card inside the auction's banners_html (our
// own renderer's output: auction/banner.ts renderCard — every attribute value
// there is escaped, so a tag never contains a raw '>').
// ---------------------------------------------------------------------------

const CARD_TAG_RE = /<a class="lg-banner"[^>]*>/g;

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? null : (m[1] as string);
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface ChosenCard {
  /** banners_html with the chosen card's tag marked data-lg-rd-chosen. */
  html: string;
  brid: string;
  faid: string;
  carrier_key: string;
  offer_public_id: string;
}

function hrefParams(tag: string): URLSearchParams {
  const href = decodeAttr(attrOf(tag, "href") ?? "");
  const q = href.indexOf("?");
  return new URLSearchParams(q === -1 ? "" : href.slice(q + 1));
}

/**
 * The chosen card, marked; null when absent. With backfill the results hold
 * two renders whose slots can repeat, so when the instruction names its render
 * (banner_render_id) the card is the one whose OWN link carries that brid AND
 * whose data-slot is the slot — nothing else is accepted. Without it (an older
 * engine) the card is the slot's card of the rule's Offer.
 */
export function markChosenCard(
  bannersHtml: string,
  instruction: Pick<RedirectAfterInstruction, "slot" | "offer_public_id" | "banner_render_id">,
): ChosenCard | null {
  const wantBrid = typeof instruction.banner_render_id === "string" && instruction.banner_render_id !== "" ? instruction.banner_render_id : null;
  let best: { index: number; tag: string } | null = null;
  let fallback: { index: number; tag: string } | null = null;
  for (const m of bannersHtml.matchAll(CARD_TAG_RE)) {
    const tag = m[0];
    if (attrOf(tag, "data-slot") !== String(instruction.slot)) continue;
    if (wantBrid !== null) {
      if (hrefParams(tag).get("brid") === wantBrid) {
        best = { index: m.index ?? 0, tag };
        break;
      }
      continue;
    }
    const offer = decodeAttr(attrOf(tag, "data-offer") ?? "");
    if (offer === instruction.offer_public_id) {
      best = { index: m.index ?? 0, tag };
      break;
    }
    if (fallback === null) fallback = { index: m.index ?? 0, tag };
  }
  const hit = best ?? fallback;
  if (hit === null) return null;
  const marked = hit.tag.replace('<a class="lg-banner"', '<a class="lg-banner" data-lg-rd-chosen="1"');
  const params = hrefParams(hit.tag);
  return {
    html: bannersHtml.slice(0, hit.index) + marked + bannersHtml.slice(hit.index + hit.tag.length),
    // The mark's value is THIS card's own link brid (= the instruction's
    // banner_render_id when given) and the slot as plain digits — exactly what
    // click.ts compares with the click's own brid/slot params.
    brid: params.get("brid") ?? "",
    faid: params.get("faid") ?? "",
    carrier_key: decodeAttr(attrOf(hit.tag, "data-carrier-key") ?? ""),
    offer_public_id: decodeAttr(attrOf(hit.tag, "data-offer") ?? ""),
  };
}

// ---------------------------------------------------------------------------
// renderRedirectScreen — the banner (badge, headline, message, animation,
// countdown line, the chosen card, "Stay here") or the animation-only screen
// (animation, headline, message, "Show me all offers"; no card on screen).
// Fail-safe: anything unexpected (no chosen card in the html, bad seconds)
// returns banners_html UNCHANGED — today's results page, never a broken one.
// ---------------------------------------------------------------------------

export function renderRedirectScreen(input: {
  banners_html: string;
  instruction: RedirectAfterInstruction;
  look: RedirectLook | null;
}): string {
  const { banners_html: bannersHtml, instruction } = input;
  if (typeof bannersHtml !== "string" || bannersHtml === "") return bannersHtml;
  const seconds = instruction.seconds;
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 30) return bannersHtml;
  if (!Number.isInteger(instruction.slot)) return bannersHtml;
  const chosen = markChosenCard(bannersHtml, instruction);
  if (chosen === null) return bannersHtml;
  const look = input.look ?? resolveRedirectLook(null, getFunnelDesign(null));
  const stay = instruction.stay_hides;
  const stayMode = stay?.mode === "offer" || stay?.mode === "carrier" ? stay.mode : "none";
  const stayKey = stay?.mode === "offer" ? stay.offer_public_id : stay?.mode === "carrier" ? stay.carrier_key : "";
  const brand = typeof instruction.brand === "string" && instruction.brand.trim() !== "" ? instruction.brand.trim() : null;
  return renderRedirectMarkup({
    display: instruction.display === "animation" ? "animation" : "banner",
    look,
    seconds,
    brand,
    logo_url: instruction.logo_url,
    cards_html: chosen.html,
    slot: instruction.slot,
    brid: chosen.brid,
    faid: chosen.faid,
    stay_mode: stayMode,
    stay_key: stayKey,
  });
}
