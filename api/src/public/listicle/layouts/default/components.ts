// Default listicle layout — §30.2 component tree.
//
//   DefaultListicleLayout
//   ├── ListicleHeader (HostLogo — the ONLY per-host brand swap · DisclosureTrigger)
//   ├── DisclosurePanel (MEASURED 2026-07-03: dropdown, outside-click dismiss)
//   ├── ArticleShell (ArticleTitle · ArticleByline · ArticleHero · IntroParagraphs
//   │                 · OfferSections[])
//   ├── LegalDisclosureBlock
//   └── Footer (FooterLogo · FooterNavLinks · FooterLegalText · Copyright)
//
// §30.3 locked editing: every style below is token-owned (styles.ts); the
// host site theme CANNOT override them — the ONLY per-host brand element is
// the logo (site settings), swapped in ListicleHeader/Footer. §30.1 header/
// typography/spacing are host-immune.
//
// The Disclosure interaction is the MEASURED behaviour (tokens.ts
// disclosureInteraction, captured 2026-07-03): a dropdown panel below the
// trigger, right-aligned, appearing instantly (no animation, no focus trap,
// no backdrop, no scroll lock); dismiss = OUTSIDE CLICK ONLY — Escape does
// NOT close it and re-clicking the trigger keeps it open. The inline script
// is ES5 (hard rule).

import { escapeHtml } from "../../../../editor/sanitize";
import type { ListicleLayout, ListicleShellVm, ListiclePageVm } from "../registry";
import { defaultLayoutCssVars } from "./styles";

// ---------------------------------------------------------------------------
// ListicleHeader — HostLogo + DisclosureTrigger + DisclosurePanel
// ---------------------------------------------------------------------------

export interface HostBrand {
  siteName: string;
  logoUrl: string | null;
}

// The measured Disclosure interaction, transcribed to ES5:
//   * click the trigger → the panel opens (re-click keeps it OPEN — the
//     trigger click always shows, never toggles);
//   * clicking anywhere OUTSIDE the .lst-disclosure wrapper closes it;
//   * Escape deliberately does NOT close (measured);
//   * no animation — class toggle only.
const DISCLOSURE_SCRIPT = [
  "(function(){",
  "var wrap=document.getElementById('lst-disclosure');",
  "if(!wrap){return;}",
  "var trigger=wrap.querySelector('.lst-disclosure-trigger');",
  "var panel=wrap.querySelector('.lst-disclosure-panel');",
  "if(!trigger||!panel){return;}",
  "trigger.addEventListener('click',function(e){",
  "e.stopPropagation();",
  "if(panel.className.indexOf('lst-open')<0){panel.className+=' lst-open';}",
  "});",
  "document.addEventListener('click',function(e){",
  "var t=e.target;",
  "while(t&&t!==document){if(t===wrap){return;}t=t.parentNode;}",
  "panel.className=panel.className.replace(/\\s*lst-open/g,'');",
  "},true);",
  "})();",
].join("");

// Neutral, our-own Disclosure copy (the reference's copy is NOT reproduced).
const DISCLOSURE_PANEL_COPY =
  "This site is a free comparison resource. We may receive compensation from " +
  "the partners whose offers appear here; compensation may affect how and " +
  "where offers are displayed. We do not include every available provider.";

export function renderHostLogo(brand: HostBrand): string {
  if (brand.logoUrl !== null && brand.logoUrl !== "") {
    return `<a class="lst-logo" href="/"><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.siteName)}" decoding="async"></a>`;
  }
  return `<a class="lst-logo" href="/"><span class="lst-logo-text">${escapeHtml(brand.siteName)}</span></a>`;
}

export function renderListicleHeader(brand: HostBrand): string {
  return [
    `<header class="lst-header">`,
    renderHostLogo(brand),
    `<div class="lst-disclosure" id="lst-disclosure">`,
    `<button type="button" class="lst-disclosure-trigger" aria-expanded="false" aria-controls="lst-disclosure-panel">Disclosure</button>`,
    `<div class="lst-disclosure-panel" id="lst-disclosure-panel" role="note">${escapeHtml(DISCLOSURE_PANEL_COPY)}</div>`,
    `</div>`,
    `</header>`,
    `<script>${DISCLOSURE_SCRIPT}</script>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Footer — near-black measured band (FooterLogo · nav · legal · copyright)
// ---------------------------------------------------------------------------

const FOOTER_LEGAL_COPY =
  "The offers that appear on this site are from partners who compensate us. " +
  "This compensation may impact how and where offers appear. This site does " +
  "not include all available offers.";

// The copyright line carries the site's BRAND identity (site settings
// site_name — the reference's own line uses its brand/domain name); the
// hostname param stays for future host-specific footer needs.
export function renderListicleFooter(brand: HostBrand, hostname: string): string {
  void hostname;
  const logo =
    brand.logoUrl !== null && brand.logoUrl !== ""
      ? `<a class="lst-footer-logo" href="/"><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.siteName)}" loading="lazy" decoding="async"></a>`
      : `<a class="lst-footer-logo" href="/"><span class="lst-logo-text">${escapeHtml(brand.siteName)}</span></a>`;
  const year = new Date().getUTCFullYear();
  return [
    `<footer class="lst-footer">`,
    `<div class="lst-footer-inner">`,
    `<div class="lst-footer-top">`,
    logo,
    `<ul class="lst-footer-nav">`,
    `<li><a href="/contact">Contact</a></li>`,
    `<li><a href="/privacy-policy">Privacy policy</a></li>`,
    `<li><a href="/terms-of-use">Terms of use</a></li>`,
    `</ul>`,
    `</div>`,
    `<hr class="lst-footer-divider">`,
    `<p class="lst-footer-legal">${escapeHtml(FOOTER_LEGAL_COPY)}</p>`,
    `<p class="lst-footer-copyright">© ${year} ${escapeHtml(brand.siteName)}</p>`,
    `</div>`,
    `</footer>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// LegalDisclosureBlock — full-width white band between last divider + footer
// ---------------------------------------------------------------------------

const LEGAL_DISCLOSURE_COPY =
  "Disclosure: this website is an advertising marketplace and comparison " +
  "service. The operator is compensated by the providers featured here, and " +
  "that compensation may influence placement. Content is informational and " +
  "is not professional advice.";

export function renderLegalDisclosureBlock(): string {
  return `<div class="lst-legal-band"><div class="lst-container"><p class="lst-legal" data-lst-binding="default.legalDisclosureBlock">${escapeHtml(LEGAL_DISCLOSURE_COPY)}</p></div></div>`;
}

// ---------------------------------------------------------------------------
// ArticleShell — title (measured two-line pattern) · byline · hero · intro
// ---------------------------------------------------------------------------

// The MEASURED two-line heading pattern (drift register `headline`): the
// authored headline's line breaks split into STACKED heading elements, each
// weight-700 via <strong> — exactly the live page's h2-pair structure. A
// single-line headline renders one line.
export function renderArticleTitle(headline: string): string {
  const lines = headline
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const safe = lines.length > 0 ? lines : [headline.trim()];
  const rendered = safe
    .map((line) => `<h2 class="lst-title-line"><strong>${escapeHtml(line)}</strong></h2>`)
    .join("");
  return `<div class="lst-title">${rendered}</div>`;
}

export function renderShell(vm: ListicleShellVm): string {
  return [
    `<div class="lst-container">`,
    `<article class="lst-article-shell">`,
    renderArticleTitle(vm.headline),
    vm.bylineHtml,
    vm.heroHtml,
    `<div class="lst-intro">${vm.introHtml}</div>`,
    vm.pagesHtml,
    `</article>`,
    `</div>`,
  ].join("");
}

// One Page slot: the §15.7 identity attributes + the chosen candidate HTML
// (plus, composed around it by the renderer, the hidden-candidate templates).
export function renderPage(page: ListiclePageVm, chosenCandidateHtml: string): string {
  return [
    `<div class="lst-page" data-page-index="${page.pageIndex}"`,
    ` data-selection-mode="${escapeHtml(page.selectionMode)}"`,
    page.abTestId !== null ? ` data-ab-test-id="${escapeHtml(page.abTestId)}"` : "",
    page.ruleSetId !== null ? ` data-rule-set-id="${escapeHtml(page.ruleSetId)}"` : "",
    ` data-default-cand="${escapeHtml(page.defaultCandidateId)}">`,
    chosenCandidateHtml,
    `</div>`,
  ].join("");
}

// One Section body inside its wrapper, followed by the O3 divider element —
// the inter-section rhythm lives on the <hr>, not on wrapper margins
// (tokens.sectionWrapper: measured margins 0; separator hr 32/20/3px #e5e7eb).
export function renderSection(sectionHtml: string): string {
  return `<section class="lst-section">${sectionHtml}</section><hr class="lst-divider">`;
}

// ---------------------------------------------------------------------------
// §14 layout object
// ---------------------------------------------------------------------------

export const defaultLayout: ListicleLayout = {
  id: "default",
  name: "Default (measured reference)",
  cssVars: defaultLayoutCssVars(),
  renderShell,
  renderPage,
  renderSection,
};
