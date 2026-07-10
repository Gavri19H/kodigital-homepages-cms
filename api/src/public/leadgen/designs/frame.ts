// LeadGen v2.5 QUOTE-FRAME RENDERER (redesign-contract-v2.5 13 §13.1 + 11 +
// 10 §10.2 + 04 §4.3). PURE: no DB, no Hono, no admin imports, no Date/random
// — pure over inputs (pinned locale) → visitor-invariant, cacheable. The ONE
// composition path shared by runtime serve, both preview endpoints, and the
// Quote Builder canvas (13 §13.4 "parity by construction — same functions,
// never a fork"; the serve.ts swap is a LATER slice — this module only
// renders).
//
// Owns:
//   - renderQuoteFrame — the composed page body (the #lg-funnel-root div and
//     everything inside it): regions per the effective frame + template
//     arrangement (04 §4.3 order), each region wrapper stamped
//     `data-frame-region="header|logo|disclosure|progress|back|background|
//     trust_strip|benefit_bar|footer|section_slot"` (admin canvas + tests key
//     on it; harmless at runtime). Region renderers REUSE the existing chrome
//     presets by SYNTHESIZING component nodes from config (renderProgressBar /
//     renderStepIndicator / renderHeaderLogo / renderBackButton /
//     renderDisclosureLink / renderSecureFormBadge / renderTrustBar /
//     renderLogoStrip / renderFooterBar) — reuse, never duplicated markup
//     logic. Emits the SAME engine hooks as today (`data-lg-progress`,
//     `data-lg-back`, `data-lg-banners`; the sections list goes inside the
//     section_slot untouched). Exactly ONE frame-owned progress mount + ONE
//     frame-owned back mount per page (11 §11.1/§11.2; legacy per-section
//     hooks inside sectionsHtml may coexist in the DOM — the engine already
//     drives every mount it finds).
//   - renderLegacyShell — `frame === null` (legacy funnels): byte-compatible
//     with the CURRENT serve.ts body structure (serve.ts renderFunnelShell
//     root-div construction mirrored 1:1; regression-pinned by
//     test/leadgen-frame-render.test.ts against the committed
//     leadgen-legacy-pin fixture).
//
// Chrome CSS for the frame regions lives in default-funnel/styles.ts
// (funnelChromeCss `frameRegions` opt — still ONE <style> block in the shell).
//
// The Continue control (`section_slot.continue_placement`, 11 §11.5) is
// rendered INSIDE the section subtree by the presets — ANOTHER slice's work;
// this module passes sectionsHtml through untouched.

import { escapeHtml } from "../../../editor/sanitize";
import { mediaUrl } from "../../view-models/media-url";
import {
  renderBackButton,
  renderDisclosureLink,
  renderFooterBar,
  renderHeaderLogo,
  renderLogoStrip,
  renderProgressBar,
  renderSecureFormBadge,
  renderStepIndicator,
  renderTrustBar,
} from "../components/presets";
import type { ComponentType } from "../components/presets";
import type { LeadgenComponentNode } from "../components/content-schema";
import type { DefaultFunnelDesign } from "./default-funnel/tokens";
import { FUNNEL_DESIGN_SCOPE_ATTR } from "./default-funnel/styles";
import type { FunnelDesign } from "./registry";
import type { EffectiveTokens } from "./theme";
import type {
  EffectiveFrameConfig,
  FrameBackConfig,
  FrameBackgroundConfig,
  FrameBenefitBarConfig,
  FrameDisclosureConfig,
  FrameHeaderConfig,
  FrameHeaderCtaConfig,
  FrameTemplateId,
  FrameTrustStripConfig,
} from "./frames";
import type { SiteBranding } from "../../../leadgen/branding";

// ---------------------------------------------------------------------------
// §10.2/§10.4 CMS fallback mark — the terminal leg of the logo ladder (site
// media → site url → site_name text mark → CMS placeholder). A configured
// env/media placeholder is a serve-slice concern (a pure module reads no env);
// this code constant is the ladder's guaranteed-non-empty floor.
// ---------------------------------------------------------------------------

export const CMS_FALLBACK_LOGO_TEXT = "Kodigital";

// The 03 §3.3 auction-mount markup serve.ts bakes today — exported so callers
// and tests share one literal for the `bannersMountHtml` input.
export const LG_BANNERS_MOUNT_HTML = '<div class="lg-banners" data-lg-banners hidden></div>';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

// The #lg-funnel-root identity attributes, exactly the values serve.ts
// interpolates today (funnel_id lgf_ / funnel_variant_id lgn_ ride as DISTINCT
// attributes — G4; content_version is the cache-axis integer).
export interface FrameRootIdentity {
  funnelId: string;
  funnelVariantId: string;
  quoteId: string;
  contentVersion: number | string;
}

export interface RenderQuoteFrameInput {
  effectiveTokens: EffectiveTokens; // resolveTokens(design, theme, overrides) (09 §9.2)
  frame: EffectiveFrameConfig; // effectiveFrame(template ⊕ funnel ⊕ variant) (13 §13.2)
  siteBranding?: SiteBranding | null; // 10 §10.1; may be ABSENT → ladder floor (§10.2)
  sectionsHtml: string; // the server-rendered <section data-lg-section> list, untouched
  bannersMountHtml: string; // the existing [data-lg-banners] mount
  // Progress total = the Funnel Variant's section-order length (11 §11.1 —
  // "progress counts the slides of this funnel variant").
  sectionCount: number;
  root: FrameRootIdentity;
}

export interface RenderLegacyShellInput {
  designId: string; // the FUNNEL_DESIGN_SCOPE_ATTR value (design.id)
  funnelId: string;
  funnelVariantId: string;
  quoteId: string;
  contentVersion: number | string;
  sectionsHtml: string;
  bannersMountHtml: string;
}

// ---------------------------------------------------------------------------
// renderLegacyShell — 13 §13.1 `frame === null` byte-compatible fallback.
// Mirrors serve.ts renderFunnelShell's body construction 1:1 (the pinned
// portion: `<div id="lg-funnel-root" …>` through `</main></div>`); the
// legacy-pin test proves byte identity against the committed fixture.
// ---------------------------------------------------------------------------

export function renderLegacyShell(input: RenderLegacyShellInput): string {
  return (
    `<div id="lg-funnel-root" ${FUNNEL_DESIGN_SCOPE_ATTR}="${escapeHtml(input.designId)}"` +
    ` data-funnel-id="${escapeHtml(input.funnelId)}"` +
    ` data-funnel-variant-id="${escapeHtml(input.funnelVariantId)}"` +
    ` data-quote-id="${escapeHtml(input.quoteId)}"` +
    ` data-content-version="${escapeHtml(String(input.contentVersion))}">` +
    '<main class="lg-content" data-lg-mount>' +
    input.sectionsHtml +
    input.bannersMountHtml +
    "</main>" +
    "</div>"
  );
}

// ---------------------------------------------------------------------------
// Region plumbing
// ---------------------------------------------------------------------------

export type FrameRegionId =
  | "header"
  | "logo"
  | "disclosure"
  | "progress"
  | "back"
  | "background"
  | "trust_strip"
  | "benefit_bar"
  | "footer"
  | "section_slot";

// §4.3 arrangement: whether the template's top band is a bare "logo" region
// (centered / full-background rows) or a "header" region (site-header rows).
// Same renderer either way — the stamp is the canvas/selection identity.
const TEMPLATE_HEADER_REGION: Record<FrameTemplateId, "header" | "logo"> = {
  centered: "logo",
  "header-footer": "header",
  "header-cta": "header",
  "full-background": "logo",
  "white-trust": "header",
  minimal: "header",
};

// A synthesized chrome node (13 §13.1 "region renderers REUSE existing presets
// by synthesizing nodes from config"). Frame-namespaced question_ids keep the
// hydration attrs harmless: chrome presets have catalog produces=null, so no
// data-lg-question is ever emitted for them.
function frameNode(
  type: ComponentType,
  id: string,
  props: Record<string, unknown>,
): LeadgenComponentNode {
  return { type, question_id: id, props };
}

// §3.3 mobile group (sparse overrides) → root modifier classes, consumed by
// the frameRegions-gated CSS at the base design's mobile breakpoint (NO
// engine cost — pure class emission + media-query rules in styles.ts):
//   * logo_size          → `lg-frame--m-logo-{s|m|l}` (re-steps the header
//     logo at the breakpoint, same token/structural steps as desktop);
//   * trust_strip_mobile → `lg-frame--m-trust-{wrap|scroll|hide}` (overrides
//     the strip's OWN `trust_strip.mobile` mode at the breakpoint);
//   * progress_position  → `lg-frame--m-progress-{pos}` (flex-order region
//     re-arrangement at the breakpoint). Emitted only when it actually MOVES
//     the mount: a value equal to the desktop position is a no-op, and a
//     desktop `in_card` mount lives INSIDE the section slot where CSS cannot
//     lift it out (that leg stays with the D-phase engine consumer). A
//     MOBILE `in_card` target approximates as "immediately above the unit"
//     (same CSS order as above_unit — a class cannot re-parent the mount).
//   * hide_footer is consumed by renderFooterRegion (lg-frame-footer--m-hide).
function mobileFrameClasses(frame: EffectiveFrameConfig): string {
  const m = frame.mobile;
  let out = "";
  if (m.logo_size !== undefined) out += ` lg-frame--m-logo-${m.logo_size}`;
  if (m.trust_strip_mobile !== undefined) out += ` lg-frame--m-trust-${m.trust_strip_mobile}`;
  if (
    m.progress_position !== undefined &&
    m.progress_position !== frame.progress.position &&
    frame.progress.position !== "in_card"
  ) {
    out += ` lg-frame--m-progress-${m.progress_position}`;
  }
  return out;
}

// One region wrapper. `hookAttrs` lets a wrapper itself carry an engine hook
// (the dots-style progress mount below); it is "" everywhere else.
function region(
  name: FrameRegionId,
  classes: string,
  inner: string,
  hookAttrs = "",
): string {
  return `<div class="lg-frame-region ${classes}" data-frame-region="${name}"${hookAttrs}>${inner}</div>`;
}

// ---------------------------------------------------------------------------
// §10.2 header logo ladder → renderHeaderLogo props
// ---------------------------------------------------------------------------

// logo_source ladder (10 §10.2/§10.4): "site" = branding.logo_url image →
// site_name text mark → CMS mark; "cms_fallback" = the CMS mark always;
// "manual" = header.logo_media_id through mediaUrl(), degrading down the
// "site" ladder when the media ref is absent/unresolvable. siteBranding may
// be ABSENT on the resolved object → the ladder floors at the CMS mark.
function logoNodeProps(
  header: FrameHeaderConfig,
  branding: SiteBranding | null,
): Record<string, unknown> {
  if (header.logo_source === "cms_fallback") {
    return { siteName: CMS_FALLBACK_LOGO_TEXT };
  }
  if (header.logo_source === "manual" && header.logo_media_id !== null) {
    const url = mediaUrl(header.logo_media_id);
    if (url !== null) {
      return {
        logoUrl: url,
        siteName: branding !== null && branding.site_name.trim() !== "" ? branding.site_name : CMS_FALLBACK_LOGO_TEXT,
        logoMediaId: header.logo_media_id,
      };
    }
  }
  // "site" (default) + the manual-without-media degrade leg.
  if (branding !== null) {
    if (branding.logo_url !== null && branding.logo_url !== "") {
      return { logoUrl: branding.logo_url, siteName: branding.site_name };
    }
    if (branding.site_name.trim() !== "") {
      return { siteName: branding.site_name };
    }
  }
  return { siteName: CMS_FALLBACK_LOGO_TEXT };
}

// ---------------------------------------------------------------------------
// Region renderers (config → synthesized preset nodes)
// ---------------------------------------------------------------------------

// Header call-CTA (§3.3 header.cta {label, href|tel}) — href derivation
// mirrors renderHeaderBar's CTA leg (tel: prefixed when the raw tel lacks it);
// the anchor itself is frame chrome (no standalone CTA preset exists) styled
// by the token-driven .lg-frame-header-cta rule.
function renderHeaderCta(cta: FrameHeaderCtaConfig): string {
  if (!cta.enabled) return "";
  const label = cta.label.trim();
  const tel = cta.tel !== null && cta.tel.trim() !== "" ? cta.tel.trim() : null;
  const href =
    cta.href !== null && cta.href.trim() !== ""
      ? cta.href.trim()
      : tel !== null
        ? tel.toLowerCase().startsWith("tel:")
          ? tel
          : `tel:${tel}`
        : null;
  if (label === "" || href === null) return "";
  return `<a class="lg-frame-header-cta" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

// The DisclosureLink preset node (11 §11.4 header/top_bar/modal legs all reuse
// the SAME link+hidden-panel markup; the modal leg differs only in CSS).
function disclosureNode(d: FrameDisclosureConfig, design: DefaultFunnelDesign): string {
  return renderDisclosureLink(
    frameNode("DisclosureLink", "frame_disclosure", { label: d.link_label, panelHtml: d.text }),
    design,
  );
}

function renderHeaderRegion(
  frame: EffectiveFrameConfig,
  design: DefaultFunnelDesign,
  branding: SiteBranding | null,
): string {
  const h = frame.header;
  if (!h.enabled) return "";
  const logo = renderHeaderLogo(frameNode("HeaderLogo", "frame_logo", logoNodeProps(h, branding)), design);
  const extras: string[] = [];
  if (h.tagline !== null && h.tagline.trim() !== "") {
    extras.push(`<p class="lg-frame-tagline">${escapeHtml(h.tagline)}</p>`);
  }
  if (h.secure_badge.enabled) {
    const text =
      h.secure_badge.text !== null && h.secure_badge.text.trim() !== ""
        ? { text: h.secure_badge.text }
        : {};
    extras.push(renderSecureFormBadge(frameNode("SecureFormBadge", "frame_secure", text), design));
  }
  const cta = renderHeaderCta(h.cta);
  if (cta !== "") extras.push(cta);
  // §11.4 location "header" = link in header; header.disclosure_link is the
  // §4.4 independent header toggle (adds the link when the panel lives
  // elsewhere). Both reuse the DisclosureLink preset, stamped as the
  // disclosure region for canvas selection.
  if (frame.disclosure.enabled && (frame.disclosure.location === "header" || h.disclosure_link)) {
    extras.push(
      `<span class="lg-frame-header-disclosure" data-frame-region="disclosure">` +
        disclosureNode(frame.disclosure, design) +
        `</span>`,
    );
  }
  const extrasHtml = extras.length > 0 ? `<div class="lg-frame-header-extras">${extras.join("")}</div>` : "";
  const classes =
    `lg-frame-header lg-frame-header--${h.logo_align} lg-frame-header--logo-${h.logo_size}` +
    (h.sticky ? " lg-frame-header--sticky" : " lg-frame-header--static");
  return region(TEMPLATE_HEADER_REGION[frame.template], classes, logo + extrasHtml);
}

// 11 §11.1 progress — rendered ONCE at frame_config.progress.position; style
// bar/dots/numbered/percent maps to renderProgressBar/renderStepIndicator with
// config-derived props. Exactly one frame-owned engine mount for every
// non-hidden style:
//   bar/numbered → the ProgressBar preset root ([data-lg-progress]
//     data-mode="step", aria-valuemax = the variant section count; `bar`
//     hides the auto step label via the --no-label chrome rule unless
//     show_label; `numbered` IS the label, always shown);
//   percent      → ProgressBar percent mode (initial width/aria derived from
//     step 1 of sectionCount; label only when show_label);
//   dots         → the StepIndicator preset renders the visual (it carries no
//     engine hook of its own), so the REGION WRAPPER carries the mount
//     (data-lg-progress data-mode="step") plus a hidden
//     [data-lg-progress-label] sink — the CURRENT engine's updateProgress
//     then stamps aria/data + writes its text into the hidden sink instead of
//     wiping the dots (render.ts falls back to el.textContent only when a
//     mount has neither bar nor label). Engine-driven dot advancement is the
//     integration slice's engine-audit leg (11 §11.6).
function renderProgressRegion(
  frame: EffectiveFrameConfig,
  design: DefaultFunnelDesign,
  sectionCount: number,
): string {
  const p = frame.progress;
  if (p.style === "hidden") return "";
  const total = Math.max(1, Math.round(sectionCount));
  let classes =
    `lg-frame-progress lg-frame-progress--${p.style} lg-frame-progress--w-${p.width}` +
    ` lg-frame-progress--th-${p.thickness} lg-frame-progress--role-${p.color_role}`;
  let inner: string;
  let hookAttrs = "";
  if (p.style === "dots") {
    inner =
      renderStepIndicator(
        frameNode("StepIndicator", "frame_progress", { steps: total, current: 1 }),
        design,
      ) + `<span class="lg-frame-progress-label" data-lg-progress-label hidden></span>`;
    hookAttrs = ` data-lg-progress data-mode="step"`;
  } else if (p.style === "percent") {
    const pct = Math.round((1 / total) * 100);
    const props: Record<string, unknown> = { mode: "percent", percent: pct };
    if (p.show_label) props["label"] = `${pct}%`;
    inner = renderProgressBar(frameNode("ProgressBar", "frame_progress", props), design);
  } else {
    // bar | numbered — step semantics carry the section-order total.
    inner = renderProgressBar(
      frameNode("ProgressBar", "frame_progress", { mode: "step", step: 1, totalSteps: total }),
      design,
    );
    if (p.style === "bar" && !p.show_label) classes += " lg-frame-progress--no-label";
  }
  return region("progress", classes, inner, hookAttrs);
}

// 11 §11.2 back — one affordance per frame_config.back; the BackButton preset
// emits the engine's [data-lg-back] hook. Initial visibility is engine-owned
// (setBackVisible hides it while back_stack is empty ⇒ hidden on the first
// Section — unchanged engine behavior, proven in the integration slice).
// history_fallback rides as a data attribute for the engine's additive tweak.
function renderBackRegion(back: FrameBackConfig, design: DefaultFunnelDesign): string {
  if (back.style === "hidden") return "";
  const btn = renderBackButton(frameNode("BackButton", "frame_back", { label: back.label }), design);
  const classes = `lg-frame-back lg-frame-back--${back.style} lg-frame-back--pos-${back.position}`;
  return region("back", classes, btn, ` data-history-fallback="${back.history_fallback ? "true" : "false"}"`);
}

// 11 §11.3 trust strip — LogoStrip preset over the config logos (media_ids
// resolved through the canonical mediaUrl prefixer; alt REQUIRED per §3.3).
// source:"site_logo_set" renders from the SiteBranding projection's
// trust_logos (the additive `site_settings.trust_logo_media_ids` list, urls
// pre-resolved by the SAME mediaUrl helper in branding.ts). AUTHORING CAVEAT:
// that settings list carries media ids ONLY — no alt copy — so alt text falls
// back to "<site name> logo <n>"; operators who need real alt copy use
// source:"manual" (alt REQUIRED there, §3.3). An absent/null/empty projection
// renders nothing — never a broken strip (unchanged fail-safe).
function renderTrustStripRegion(
  t: FrameTrustStripConfig,
  design: DefaultFunnelDesign,
  branding: SiteBranding | null,
): string {
  if (!t.enabled) return "";
  const siteMark =
    branding !== null && branding.site_name.trim() !== "" ? branding.site_name : CMS_FALLBACK_LOGO_TEXT;
  const logos =
    t.source === "manual"
      ? t.logos
          .map((l) => ({ mediaId: mediaUrl(l.media_id), alt: l.alt }))
          .filter((l): l is { mediaId: string; alt: string } => l.mediaId !== null)
      : (branding?.trust_logos ?? []).map((l, i) => ({
          mediaId: l.url,
          alt: `${siteMark} logo ${i + 1}`,
        }));
  if (logos.length === 0) return "";
  const strip = renderLogoStrip(frameNode("LogoStrip", "frame_trust", { logos }), design);
  const classes = `lg-frame-trust lg-frame-trust--${t.mobile} lg-frame-trust--pos-${t.placement}`;
  return region("trust_strip", classes, strip);
}

// 11 §11.3 benefit bar — icon/text pairs are exactly the TrustBar preset's
// structured items (C7: same renderers, scope disambiguated by labeling).
function renderBenefitRegion(b: FrameBenefitBarConfig, design: DefaultFunnelDesign): string {
  if (!b.enabled || b.items.length === 0) return "";
  const bar = renderTrustBar(
    frameNode("TrustBar", "frame_benefit", { items: b.items.map((i) => ({ icon: i.icon, text: i.text })) }),
    design,
  );
  return region("benefit_bar", `lg-frame-benefit lg-frame-benefit--pos-${b.placement}`, bar);
}

// §10.2 footer logo (footer.show_logo): the site's image mark, else its text
// mark, else the CMS mark — frame chrome (FooterBar has no logo slot).
function renderFooterLogo(branding: SiteBranding | null): string {
  if (branding !== null && branding.logo_url !== null && branding.logo_url !== "") {
    return `<img class="lg-frame-footer-logo" src="${escapeHtml(branding.logo_url)}" alt="${escapeHtml(branding.site_name)}" decoding="async">`;
  }
  const mark = branding !== null && branding.site_name.trim() !== "" ? branding.site_name : CMS_FALLBACK_LOGO_TEXT;
  return `<span class="lg-frame-footer-logo-text">${escapeHtml(mark)}</span>`;
}

// 11 §11.3 footer — the FooterBar preset over config-derived props.
// links_source:"site" renders siteBranding.legal_links; a missing/empty
// source OMITS the links group (never empty anchors, 10 §10.2). show_on rides
// as a data attribute + class ("never" renders nothing at all). `extraInner`
// carries the footer-placed sub-regions (trust strip / disclosure text /
// back link).
//
// SSR visibility bake (DEV-57): the rendered page IS step 1, so the engine's
// step-1 verdict is baked into the markup — show_on:"final" arrives `hidden`
// whenever the funnel has more than one Section (step 1 is never final);
// a single-Section funnel's step 1 IS final, so it stays visible.
// show_on:"first"/"all" stay visible (step 1 IS first). Without the bake a
// "final" footer flashes until hydration and shows permanently with JS off.
// The engine (render.ts updateFooterVisibility) re-derives visibility on
// every step change exactly as before.
function renderFooterRegion(
  frame: EffectiveFrameConfig,
  design: DefaultFunnelDesign,
  branding: SiteBranding | null,
  extraInner: string,
  sectionCount: number,
): string {
  const f = frame.footer;
  if (!f.enabled || f.show_on === "never") return "";
  const links = (f.links_source === "site" ? (branding?.legal_links ?? []) : f.links).filter(
    (l) => l.label.trim() !== "" && l.href.trim() !== "",
  );
  const props: Record<string, unknown> = {};
  if (f.trust_text !== null && f.trust_text.trim() !== "") props["trustMessages"] = [f.trust_text];
  if (links.length > 0) props["links"] = links.map((l) => ({ label: l.label, href: l.href }));
  if (f.description !== null && f.description.trim() !== "") props["legalHtml"] = f.description;
  const bar = renderFooterBar(frameNode("FooterBar", "frame_footer", props), design);
  const logo = f.show_logo ? renderFooterLogo(branding) : "";
  const hideMobile = f.hide_on_mobile || frame.mobile.hide_footer === true;
  const classes =
    `lg-frame-footer lg-frame-footer--show-${f.show_on}` + (hideMobile ? " lg-frame-footer--m-hide" : "");
  const bakedHidden = f.show_on === "final" && sectionCount > 1 ? " hidden" : "";
  return region("footer", classes, logo + bar + extraInner, ` data-show-on="${f.show_on}"${bakedHidden}`);
}

// §3.3 background — the page-background layer, selected by ROLE + STYLE
// classes only (no raw CSS values in markup; the funnelChromeCss frame rules
// resolve each role/style class to token values). An image_media_id renders
// the BackgroundPanel cover-image idiom under the frame's own class.
function renderBackgroundRegion(bg: FrameBackgroundConfig): string {
  let img = "";
  if (bg.image_media_id !== null) {
    const url = mediaUrl(bg.image_media_id);
    if (url !== null) {
      img = `<img class="lg-frame-bg-img" src="${escapeHtml(url)}" alt="" decoding="async">`;
    }
  }
  return (
    `<div class="lg-frame-background lg-frame-bg-role-${bg.role} lg-frame-bg-style-${bg.style}"` +
    ` data-frame-region="background" aria-hidden="true">${img}</div>`
  );
}

// §3.3 section_slot — the swapped-section area: config classes on the wrapper,
// the engine's data-lg-mount <main> inside it, sectionsHtml UNTOUCHED, the
// [data-lg-banners] mount after the sections exactly as today. in_card chrome
// (progress/back) renders INSIDE the wrapper, OUTSIDE the swapped sections —
// still one mount each (11 §11.1).
function renderSlotRegion(
  frame: EffectiveFrameConfig,
  sectionsHtml: string,
  bannersMountHtml: string,
  inCardChrome: string,
): string {
  const s = frame.section_slot;
  const classes =
    `lg-frame-slot lg-frame-slot--${s.card} lg-frame-slot--w-${s.max_width}` +
    ` lg-frame-slot--pad-${s.padding} lg-frame-slot--off-${s.offset_y}` +
    ` lg-frame-slot--t-${s.transition} lg-frame-slot--align-${s.align}`;
  return region(
    "section_slot",
    classes,
    inCardChrome + '<main class="lg-content" data-lg-mount>' + sectionsHtml + bannersMountHtml + "</main>",
  );
}

// ---------------------------------------------------------------------------
// renderQuoteFrame — 13 §13.1 the one composition path.
//
// Canonical order (all six §4.3 arrangements fall out of it because the
// template DEFAULTS in frames.ts encode the per-template positions):
//   background → disclosure(top_bar) → progress(top) → header/logo →
//   progress(under_header) → back(under_header_left) →
//   trust(between_progress_and_unit) → progress(above_unit) →
//   section_slot[progress(in_card) + back(in_card) + sections + banners] →
//   back(below_card) → trust(below_unit) → benefit(below_unit) →
//   footer[trust(footer) + disclosure(footer) + back(footer)] →
//   benefit(bottom) → disclosure(modal).
// ---------------------------------------------------------------------------

export function renderQuoteFrame(input: RenderQuoteFrameInput): string {
  const { effectiveTokens, frame, sectionsHtml, bannersMountHtml, sectionCount, root } = input;
  // EffectiveFunnelDesign keeps the FunnelDesign STRUCTURE (theme.ts §9.2) —
  // the presets consume it unchanged; the assertion narrows widened leaves
  // back onto the literal shape the frozen preset signatures declare.
  const design = effectiveTokens.design as FunnelDesign;
  const branding = input.siteBranding ?? null;

  // Position-keyed slots: each chrome piece renders ONCE at its configured
  // position; every other slot of that piece stays empty.
  const progressAt: Record<EffectiveFrameConfig["progress"]["position"], string> = {
    top: "",
    under_header: "",
    above_unit: "",
    in_card: "",
  };
  progressAt[frame.progress.position] = renderProgressRegion(frame, design, sectionCount);

  const backAt: Record<EffectiveFrameConfig["back"]["position"], string> = {
    under_header_left: "",
    in_card: "",
    below_card: "",
    footer: "",
  };
  backAt[frame.back.position] = renderBackRegion(frame.back, design);

  const trustAt: Record<EffectiveFrameConfig["trust_strip"]["placement"], string> = {
    below_unit: "",
    footer: "",
    between_progress_and_unit: "",
  };
  trustAt[frame.trust_strip.placement] = renderTrustStripRegion(frame.trust_strip, design, branding);

  const benefitAt: Record<EffectiveFrameConfig["benefit_bar"]["placement"], string> = {
    bottom: "",
    below_unit: "",
  };
  benefitAt[frame.benefit_bar.placement] = renderBenefitRegion(frame.benefit_bar, design);

  const d = frame.disclosure;
  const discTopBar =
    d.enabled && d.location === "top_bar"
      ? region("disclosure", "lg-frame-disclosure lg-frame-disclosure--top_bar", disclosureNode(d, design))
      : "";
  const discModal =
    d.enabled && d.location === "modal"
      ? region("disclosure", "lg-frame-disclosure lg-frame-disclosure--modal", disclosureNode(d, design))
      : "";
  // §11.4 footer location = inline text (no toggle).
  const discFooter =
    d.enabled && d.location === "footer" && d.text.trim() !== ""
      ? `<div class="lg-frame-footer-disclosure" data-frame-region="disclosure">${escapeHtml(d.text)}</div>`
      : "";

  const footer = renderFooterRegion(
    frame,
    design,
    branding,
    trustAt.footer + discFooter + backAt.footer,
    sectionCount,
  );
  // A footer-positioned back/trust must not vanish with a disabled footer —
  // exactly one affordance per config (§11.2): fall back to standalone regions
  // at the footer slot position.
  const footerOrphans = footer === "" ? trustAt.footer + backAt.footer : "";

  return (
    `<div id="lg-funnel-root" class="lg-frame lg-frame--${frame.template}${mobileFrameClasses(frame)}"` +
    ` ${FUNNEL_DESIGN_SCOPE_ATTR}="${escapeHtml(design.id)}"` +
    ` data-funnel-id="${escapeHtml(root.funnelId)}"` +
    ` data-funnel-variant-id="${escapeHtml(root.funnelVariantId)}"` +
    ` data-quote-id="${escapeHtml(root.quoteId)}"` +
    ` data-content-version="${escapeHtml(String(root.contentVersion))}"` +
    ` data-frame-template="${escapeHtml(frame.template)}">` +
    renderBackgroundRegion(frame.background) +
    discTopBar +
    progressAt.top +
    renderHeaderRegion(frame, design, branding) +
    progressAt.under_header +
    backAt.under_header_left +
    trustAt.between_progress_and_unit +
    progressAt.above_unit +
    renderSlotRegion(frame, sectionsHtml, bannersMountHtml, progressAt.in_card + backAt.in_card) +
    backAt.below_card +
    trustAt.below_unit +
    benefitAt.below_unit +
    footer +
    footerOrphans +
    benefitAt.bottom +
    discModal +
    `</div>`
  );
}
