// Public listicle document renderer — §7.2 GET /:slug (published listicle),
// §22.3 speed budget, §22.4 candidates-in-shell + payload guard, §30.2
// component order, §21 GA4 via the existing custom-head path.
//
// This module is PURE assembly: the caller (serve.ts) loads every row and
// hands the data in; the renderer emits the full HTML document string for
// ONE Version (= one cached shell per lander_v, §15.2/§22).

import { listicleBlocksToHtml, offerRefString, GOVERNED_LINK_REL } from "../../editor/listicle-blocks";
import { escapeHtml, isSafeUrl } from "../../editor/sanitize";
import { responsiveImg } from "../templates/responsive-img";
import { renderCustomHead, renderConsentHead } from "../../settings/custom-html";
import { getLayout, type ListiclePageVm } from "./layouts/registry";
import { defaultLayoutCss } from "./layouts/default/styles";
import {
  renderListicleHeader,
  renderListicleFooter,
  renderLegalDisclosureBlock,
  type HostBrand,
} from "./layouts/default/components";
import {
  rewriteGovernedAnchors,
  collectOfferRefs,
  type GovernedUrlContext,
} from "./governed-url";
import {
  selectorScriptTag,
  beaconScriptTag,
  safeInlineJson,
} from "./runtime";

// ---------------------------------------------------------------------------
// §22.4 payload-guard constants (config consts, "~40 KB or ~50% whichever
// first")
// ---------------------------------------------------------------------------

// Hidden-candidate HTML budget: absolute cap in bytes.
export const LST_CANDIDATE_BUDGET_BYTES = 40 * 1024;
// Hidden-candidate HTML budget: ratio cap — hidden bytes may not exceed 50%
// of the total payload, i.e. hiddenBytes <= inlineBytes.
export const LST_CANDIDATE_BUDGET_RATIO = 0.5;
// Pages with page_index < this count are treated as (potentially) above the
// fold: they are NEVER post-paint lazy-hydrated (§22.4) — their candidates
// stay inline even when the page is over budget.
export const LST_ABOVE_FOLD_PAGE_COUNT = 1;
// Reserved box for a lazy-hydrating candidate container (min-height floor,
// §22.4 "containers reserve dimensions so the swap causes zero CLS"). The
// exact candidate height is unknowable server-side; this floor + the
// aspect-ratio reservations on media keep the swap CLS-free (proven by the
// Playwright CLS assertion, not by this constant alone).
export const LST_LAZY_CANDIDATE_MIN_HEIGHT_PX = 200;

// §22.4 budget predicate: hidden-candidate HTML rides inside the shell only
// while BOTH caps hold — under ~40 KB AND under ~50% of the total payload
// (hidden <= inline ⇔ hidden/(hidden+inline) <= 0.5), whichever trips first.
export function withinCandidateBudget(hiddenBytes: number, inlineBytes: number): boolean {
  if (hiddenBytes > LST_CANDIDATE_BUDGET_BYTES) return false;
  const total = hiddenBytes + inlineBytes;
  if (total === 0) return true;
  return hiddenBytes / total <= LST_CANDIDATE_BUDGET_RATIO;
}

// ---------------------------------------------------------------------------
// Input shapes (loaded by serve.ts)
// ---------------------------------------------------------------------------

export interface RenderSectionRow {
  id: number;
  public_id: string;
  section_name: string;
  headline_text: string;
  headline_offer_id: number | null;
  image_json: string | null;
  content_json: string;
  // §30.7: the ledger's __headline__ link-instance public id (lnk_…) for a
  // clickable Section headline — stamped into the governed anchor's lnk=.
  headline_link_instance_id?: string | null;
}

export interface RenderCandidate {
  public_id: string;
  section_id: number;
  is_fallback: number;
  rule_public_id: string | null;
  // Phase-7 selector boot data (optional — Phase-6 call sites/tests omit
  // them; the boot payload then carries ""/null and the client selector
  // degrades exactly like a page with no metadata).
  section_public_id?: string;
  section_name?: string;
  traffic_allocation?: number | null;
  rule_priority?: number | null;
  rule_conditions_json?: string | null;
  rule_conditions_hash?: string | null;
}

export interface RenderPage {
  public_id: string;
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  rule_set_id: string | null;
  candidates: RenderCandidate[];
}

export interface RenderVersion {
  public_id: string;
  headline: string;
  intro_paragraph: string;
  hero_url: string | null;
  byline_json: string | null;
  layout_style_id: string;
  content_version: number;
}

export interface RenderArticle {
  public_id: string;
  slug: string;
  // Phase-7 boot data (optional — older call sites omit it → "").
  article_name?: string;
}

export interface ListicleRenderInput {
  hostname: string;
  brand: HostBrand;
  settings: Readonly<Record<string, string>>;
  article: RenderArticle;
  version: RenderVersion;
  pages: ReadonlyArray<RenderPage>;
  sections: ReadonlyMap<number, RenderSectionRow>;
  // data-offer value (off_… public id OR legacy numeric string) → off_… id.
  offerPublicIdByRef: ReadonlyMap<string, string>;
  // Phase-7 boot data: the tenant site id for the §16 site_id column
  // (optional — older call sites omit it → "").
  siteId?: string;
}

export interface ListicleRenderResult {
  html: string;
  // candidate_public_ids the shell defers to GET /lst-cand/:id (over-budget
  // below-fold pages).
  lazyCandidateIds: string[];
}

// ---------------------------------------------------------------------------
// Section rendering (§30.2 OfferSections)
// ---------------------------------------------------------------------------

interface SectionImageJson {
  url?: string;
}

function sectionImageUrl(imageJson: string | null): string {
  if (imageJson === null || imageJson.trim() === "") return "";
  try {
    const parsed = JSON.parse(imageJson) as SectionImageJson;
    return typeof parsed.url === "string" ? parsed.url : "";
  } catch {
    return "";
  }
}

// Intrinsic dims for reserved layout space (anti-CLS): the measured content
// column is ~968px; hero is 2:1 (tokens.heroImage.aspectRatio), section
// images 16:9 (tokens.sectionImage.aspectRatio).
const CONTENT_WIDTH_PX = 968;
const HERO_HEIGHT_PX = 484; // 968 / (2/1)
const SECTION_IMG_HEIGHT_PX = 545; // round(968 / (16/9))

// The MEASURED linked-section-heading structure: h3 wrapped in <a> inside a
// pt-4px/mb-8px wrapper; every heading starts with the numbered badge span
// (tokens.sectionHeading.measured.numberBadge — '1.'…'6.').
export function renderSectionHeading(
  section: RenderSectionRow,
  ordinal: number,
): string {
  if (section.headline_text === "") return "";
  const badge = `<span class="lst-heading-badge">${ordinal}.</span>`;
  const text = `${badge} ${escapeHtml(section.headline_text)}`;
  const heading = `<h3>${text}</h3>`;
  const offerRef = offerRefString(section.headline_offer_id);
  const headlineLnk = section.headline_link_instance_id ?? "";
  const inner =
    offerRef === ""
      ? heading
      : `<a data-offer="${escapeHtml(offerRef)}" data-link-instance="${escapeHtml(headlineLnk)}" data-block-id="__headline__" data-link-role="headline" rel="${GOVERNED_LINK_REL}">${heading}</a>`;
  return `<div class="lst-heading-wrap">${inner}</div>`;
}

function renderSectionImage(section: RenderSectionRow): string {
  const url = sectionImageUrl(section.image_json);
  if (url === "" || !isSafeUrl(url)) return "";
  const img = responsiveImg({
    src: url,
    alt: section.headline_text,
    width: CONTENT_WIDTH_PX,
    height: SECTION_IMG_HEIGHT_PX,
    loading: "lazy",
    sizes: "(max-width: 999px) 100vw, 968px",
  });
  if (img === "") return "";
  return `<div class="lst-img">${img}</div>`;
}

// Annotate each choice-button group with its measured grid mode: 2- and
// 4-button groups render 2 columns at every measured viewport; other counts
// render 1 column (<1024px) / 3 columns (≥1024px)
// (tokens.choiceButtonGroup.measured — grid-cols-2 vs grid-cols-1 lg:grid-cols-3).
export function annotateChoiceGroupColumns(html: string): string {
  return html.replace(
    /<div class="lst-choice-group"((?:[^>"']|"[^"]*")*)>([\s\S]*?)<\/div>/g,
    (_whole: string, attrs: string, inner: string) => {
      const buttons = (inner.match(/class="lst-choice-btn"/g) ?? []).length;
      const cols = buttons === 2 || buttons === 4 ? "2" : "auto";
      return `<div class="lst-choice-group" data-lst-cols="${cols}"${attrs}>${inner}</div>`;
    },
  );
}

// Render ONE Section (heading + image + blocks) with governed /lc hrefs
// minted for the given candidate context. Ordinal drives the numbered badge.
export function renderSectionCandidateHtml(
  section: RenderSectionRow,
  ordinal: number,
  ctx: GovernedUrlContext,
  offerPublicIdByRef: ReadonlyMap<string, string>,
): string {
  const parts = [
    renderSectionHeading(section, ordinal),
    renderSectionImage(section),
    annotateChoiceGroupColumns(listicleBlocksToHtml(section.content_json)),
  ].join("");
  return rewriteGovernedAnchors(parts, ctx, offerPublicIdByRef);
}

// ---------------------------------------------------------------------------
// Byline (§30.2 ArticleByline; shape = §30.2 ArticleVersionByline)
// ---------------------------------------------------------------------------

interface BylineJson {
  enabled?: boolean;
  author_name?: string;
  author_avatar_url?: string;
  label?: string;
  updated_label?: string;
  updated_date?: string;
}

export function renderByline(bylineJson: string | null): string {
  if (bylineJson === null || bylineJson.trim() === "") return "";
  let byline: BylineJson;
  try {
    byline = JSON.parse(bylineJson) as BylineJson;
  } catch {
    return "";
  }
  if (byline.enabled !== true) return "";
  const avatarUrl = typeof byline.author_avatar_url === "string" ? byline.author_avatar_url : "";
  const avatar =
    avatarUrl !== "" && isSafeUrl(avatarUrl)
      ? `<img class="lst-byline-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(byline.author_name ?? "")}" loading="lazy" decoding="async">`
      : "";
  const parts: string[] = [];
  const label = (byline.label ?? "").trim();
  if (label !== "") parts.push(escapeHtml(label));
  const author = (byline.author_name ?? "").trim();
  if (author !== "") parts.push(`By ${escapeHtml(author)}`);
  const updated = `${(byline.updated_label ?? "").trim()} ${(byline.updated_date ?? "").trim()}`.trim();
  if (updated !== "") parts.push(escapeHtml(updated));
  if (avatar === "" && parts.length === 0) return "";
  return `<div class="lst-byline">${avatar}<h5 class="lst-byline-text">${parts.join(" · ")}</h5></div>`;
}

// ---------------------------------------------------------------------------
// ES5 lazy-hydrator (over-budget below-fold candidates, §22.4)
// ---------------------------------------------------------------------------
// The fragment inserted is OUR OWN server-rendered, sanitizer-governed HTML
// from the same-origin cached /lst-cand endpoint (the exact render pipeline
// that produced the shell) — never third-party/user-raw markup. The
// placeholder is empty, so insertAdjacentHTML fills it in place.
//
// SCHEDULING (review finding 2 — structural zero-CLS): hydration is EAGER ON
// LOAD-IDLE. The /lst-cand fetches fire immediately after the window `load`
// event via requestIdleCallback (2s timeout so hydration can never be
// starved) with a plain ES5 setTimeout(0) fallback — NOT on scroll-into-view.
// So the swap happens long before a user can scroll to a below-fold page
// under any realistic latency, and it never competes with the critical-path
// resources (hero etc.) before `load`. The min-height reservation floor +
// the aspect-ratio media reservations remain as the extreme-latency-tail
// fallback only.

const LAZY_HYDRATE_SCRIPT = [
  "(function(){",
  "function hydrate(el){",
  "var url=el.getAttribute('data-lst-lazy');",
  "if(!url){return;}",
  "var x=new XMLHttpRequest();",
  "x.open('GET',url,true);",
  "x.onreadystatechange=function(){",
  "if(x.readyState===4&&x.status===200){",
  "el.insertAdjacentHTML('afterbegin',x.responseText);",
  "el.className=el.className.replace(/\\s*lst-cand-pending/g,'');",
  "el.style.minHeight='';",
  "el.removeAttribute('data-lst-lazy');",
  // Phase 7: re-run the beacon scan so freshly hydrated governed anchors
  // get pv= stamped + observed (idempotent — see runtime.ts __lstScan).
  "if(window.__lstScan){try{window.__lstScan();}catch(e){}}",
  "}",
  "};",
  "x.send();",
  "}",
  "function hydrateAll(){",
  "var els=document.querySelectorAll('[data-lst-lazy]');",
  "for(var i=0;i<els.length;i++){hydrate(els[i]);}",
  "}",
  "function schedule(){",
  "if(window.requestIdleCallback){requestIdleCallback(hydrateAll,{timeout:2000});}",
  "else{setTimeout(hydrateAll,0);}",
  "}",
  "if(document.readyState==='complete'){schedule();}",
  "else{window.addEventListener('load',schedule);}",
  "})();",
].join("");

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function metaDescription(intro: string): string {
  const flat = intro.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

// The default candidate per Page — INTERIM `single_default` SEMANTICS FOR
// ALL MODES (declared loudly): no per-user page-level selection exists until
// the Phase-7 client selector ships, so the server marks ONE deterministic
// candidate visible in the shell (no flicker, no cloaking):
//   * single    → the first candidate (stored order),
//   * ab_test   → the first candidate (stored order; the sticky ab-hash pick
//                 is the Phase-7 client's job — §15.3),
//   * rule_based→ the FALLBACK candidate (what an audience with no matching
//                 rule receives — §15.4's required catch-all).
export function defaultCandidate(page: RenderPage): RenderCandidate | null {
  if (page.candidates.length === 0) return null;
  if (page.selection_mode === "rule_based") {
    return page.candidates.find((cand) => cand.is_fallback === 1) ?? page.candidates[0]!;
  }
  return page.candidates[0]!;
}

export function renderListicleDocument(input: ListicleRenderInput): ListicleRenderResult {
  const layout = getLayout(input.version.layout_style_id);

  // ---- per-page candidate rendering ---------------------------------------
  interface PageBuild {
    page: RenderPage;
    vm: ListiclePageVm;
    defaultCand: RenderCandidate | null;
    visibleHtml: string; // the default candidate's .lst-cand block
    hiddenHtml: string; // <template> blocks for the alternates
    hiddenBytes: number;
    visibleBytes: number;
  }

  const builds: PageBuild[] = [];
  let ordinal = 0;
  for (const page of [...input.pages].sort((a, b) => a.page_index - b.page_index)) {
    ordinal += 1;
    const def = defaultCandidate(page);
    let visibleHtml = "";
    let hiddenHtml = "";
    for (const cand of page.candidates) {
      const section = input.sections.get(cand.section_id);
      if (section === undefined) continue;
      const ctx: GovernedUrlContext = {
        articlePublicId: input.article.public_id,
        landerV: input.version.public_id,
        pageIndex: page.page_index,
        sectionPublicId: section.public_id,
        candidatePublicId: cand.public_id,
        selectionMode: page.selection_mode,
        ruleId: cand.rule_public_id ?? "",
      };
      const sectionHtml = renderSectionCandidateHtml(
        section,
        ordinal,
        ctx,
        input.offerPublicIdByRef,
      );
      const body = layout.renderSection(sectionHtml);
      if (def !== null && cand.public_id === def.public_id) {
        visibleHtml = `<div class="lst-cand" data-cand="${escapeAttr(cand.public_id)}" data-section="${escapeAttr(section.public_id)}">${body}</div>`;
      } else {
        // Hidden candidates ship as INERT <template> blocks: nothing inside a
        // template loads (images/GIFs are not fetched) — the §22.4
        // "<template>/data-src non-loading media" requirement, template form.
        hiddenHtml += `<template class="lst-cand-tpl" data-cand="${escapeAttr(cand.public_id)}" data-section="${escapeAttr(section.public_id)}">${body}</template>`;
      }
    }
    builds.push({
      page,
      vm: {
        pageIndex: page.page_index,
        selectionMode: page.selection_mode,
        abTestId: page.ab_test_id,
        ruleSetId: page.rule_set_id,
        defaultCandidateId: def?.public_id ?? "",
      },
      defaultCand: def,
      visibleHtml,
      hiddenHtml,
      hiddenBytes: byteLength(hiddenHtml),
      visibleBytes: byteLength(visibleHtml),
    });
  }

  // ---- §22.4 payload guard -------------------------------------------------
  const totalHidden = builds.reduce((sum, b) => sum + b.hiddenBytes, 0);
  const totalVisible = builds.reduce((sum, b) => sum + b.visibleBytes, 0);
  const overBudget = !withinCandidateBudget(totalHidden, totalVisible);

  const lazyCandidateIds: string[] = [];
  const pagesHtml = builds
    .map((build) => {
      // Phase 7: right after each page's markup, the shell calls the §15.3
      // materializer so a chosen NON-default candidate is stamped out of its
      // inert <template> (or the lazy placeholder is re-pointed at the
      // chosen /lst-cand fragment) DURING parse — before that region ever
      // paints (zero CLS).
      const materialize = `<script>window.__lstMat&&window.__lstMat(${build.page.page_index})</script>`;
      const isAboveFold = build.page.page_index < LST_ABOVE_FOLD_PAGE_COUNT;
      if (overBudget && !isAboveFold) {
        // Below-fold page on an over-budget shell: the DEFAULT candidate
        // lazy-hydrates from the cached per-candidate endpoint
        // GET /lst-cand/:candidate_public_id with a reserved box (zero CLS);
        // hidden alternates are NOT shipped (the §15.3 selector re-points
        // the placeholder at the CHOSEN candidate's /lst-cand fragment).
        const def = build.defaultCand;
        if (def === null) return layout.renderPage(build.vm, "");
        lazyCandidateIds.push(def.public_id);
        const placeholder = `<div class="lst-cand lst-cand-pending" data-cand="${escapeAttr(def.public_id)}" data-lst-lazy="/lst-cand/${encodeURIComponent(def.public_id)}" style="min-height:${LST_LAZY_CANDIDATE_MIN_HEIGHT_PX}px"></div>`;
        return layout.renderPage(build.vm, placeholder) + materialize;
      }
      return layout.renderPage(build.vm, build.visibleHtml + build.hiddenHtml) + materialize;
    })
    .join("\n");

  // ---- §15.3 selector boot data (per-shell, visitor-invariant) ------------
  // Everything the pre-paint selector + beacon need that is a property of
  // the VERSION (cache-safe): the page/candidate graph incl. allocations +
  // parsed rule conditions, and the article identity dims. Per-REQUEST
  // context (_LST_SID/__LST_CTX/__LST_EXP) is injected post-cache
  // (ctx-inject.ts) and is NEVER part of this cached payload.
  const bootPages = builds.map((build) => ({
    page_index: build.page.page_index,
    mode: build.page.selection_mode,
    ab_test_id: build.page.ab_test_id ?? "",
    rule_set_id: build.page.rule_set_id ?? "",
    default_candidate_id: build.vm.defaultCandidateId,
    candidates: build.page.candidates.map((cand) => ({
      id: cand.public_id,
      section_id: cand.section_public_id ?? "",
      section_name: cand.section_name ?? "",
      allocation: cand.traffic_allocation ?? null,
      is_fallback: cand.is_fallback,
      rule:
        cand.rule_public_id !== null && cand.rule_public_id !== ""
          ? {
              id: cand.rule_public_id,
              priority: cand.rule_priority ?? 100,
              conditions: parseRuleConditionsJson(cand.rule_conditions_json ?? null),
              hash: cand.rule_conditions_hash ?? "",
            }
          : null,
    })),
  }));
  const boot = {
    site_id: input.siteId ?? "",
    article_id: input.article.public_id,
    article_name: input.article.article_name ?? "",
    article_url: `https://${input.hostname}/${encodeURIComponent(input.article.slug)}`,
    lander_v: input.version.public_id,
    article_version_revision: input.version.content_version,
  };
  const bootScript = `<script data-lst="boot">window.__LST_BOOT=${safeInlineJson(boot)};window.__LST_PAGES=${safeInlineJson(bootPages)};window.__LST_CHOSEN={}</script>`;

  // ---- shell ---------------------------------------------------------------
  const heroHtml =
    input.version.hero_url !== null && input.version.hero_url !== "" && isSafeUrl(input.version.hero_url)
      ? `<div class="lst-hero">${responsiveImg({
          src: input.version.hero_url,
          alt: input.version.headline.split(/\r?\n/)[0] ?? "",
          width: CONTENT_WIDTH_PX,
          height: HERO_HEIGHT_PX,
          loading: "eager",
          fetchpriority: "high",
          sizes: "(max-width: 999px) 100vw, 968px",
        })}</div>`
      : "";

  const introHtml = input.version.intro_paragraph
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  const shellHtml = layout.renderShell({
    headline: input.version.headline,
    bylineHtml: renderByline(input.version.byline_json),
    heroHtml,
    introHtml,
    pagesHtml,
  });

  // ---- head (§21 GA4 via renderCustomHead; canonical/SEO minimal) ----------
  // The HOMEPAGE beacon script (ANALYTICS_TRACKING_SCRIPT) is deliberately
  // NOT included — the richer listicle beacon (§16, POST /api/lst/track) is
  // Phase 7.
  const consentHead = renderConsentHead(input.settings);
  const customHead = renderCustomHead(input.settings);
  const titleLine = input.version.headline.replace(/\s+/g, " ").trim();
  const canonical = `https://${input.hostname}/${encodeURIComponent(input.article.slug)}`;
  const description = metaDescription(input.version.intro_paragraph);

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(titleLine)}</title>`,
    description !== "" ? `<meta name="description" content="${escapeAttr(description)}">` : "",
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    `<meta property="og:title" content="${escapeAttr(titleLine)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${escapeAttr(canonical)}">`,
    `<style>${defaultLayoutCss()}</style>`,
    // No-JS fallback: without the §15.3 selector, the DEFAULT candidates
    // (the only .lst-cand divs in the shell — alternates are inert
    // <template>s) render. The Phase-6 interim static style is REPLACED by
    // the selector's §15.3 pre-paint style pass.
    `<noscript><style>.lst-cand{display:block!important}</style></noscript>`,
    consentHead,
    customHead,
    // §15.3 boot data + pre-paint selector. The post-cache context script
    // (_LST_SID/__LST_CTX/__LST_EXP, ctx-inject.ts) is injected immediately
    // BEFORE the selector tag on the live response.
    bootScript,
    selectorScriptTag(),
  ]
    .filter((part) => part !== "")
    .join("\n");

  const lazyScript = lazyCandidateIds.length > 0 ? `<script>${LAZY_HYDRATE_SCRIPT}</script>` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
${head}
</head>
<body data-layout="default" data-lander-v="${escapeAttr(input.version.public_id)}">
${renderListicleHeader(input.brand)}
${shellHtml}
${renderLegalDisclosureBlock()}
${renderListicleFooter(input.brand, input.hostname)}
${lazyScript}
${beaconScriptTag()}
</body>
</html>`;

  return { html, lazyCandidateIds };
}

// Parse a stored rule conditions_json for the selector boot payload.
// Corrupt/absent → {} (the client treats it as "any audience" — the same
// degradation the edge rules evaluator applies to an empty conditions set).
function parseRuleConditionsJson(raw: string | null): unknown {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export { collectOfferRefs };
