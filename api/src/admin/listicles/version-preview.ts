// Article Version preview (design contract §30.6) — Phase 5.
//
// POST /api/admin/listicles/versions/:id/preview renders the FULL page in the
// §30.2 component order — red 64px header (logo slot + top-right Disclosure
// trigger), ArticleShell (title, byline, hero, intro), every Page's CHOSEN
// Section (button groups + final CTAs render through the SAME listicle block
// renderers/govern pass as the live pipeline), the legal block, and the
// footer — styled by CSS GENERATED from `defaultListicleLayoutTokens`
// (page-chrome groups here + the §30.6 section stylesheet reused from
// tokens-to-css.ts). Served into a sandbox="" srcdoc iframe.
//
// Controls (§30.6):
//   * force Version — the builder POSTs to any /versions/:id (live overrides
//     ride the body only for the version being edited);
//   * force a Page candidate (body.force_candidates[page_index] = cand_…);
//   * simulate rule audience dims (body.ctx) — rule_based pages are chosen
//     via the SAME evaluation semantics as the runtime (rules.ts
//     parseConditions + evaluateRules: priority asc, first match wins,
//     fallback catches the rest);
//   * Page CTA Density — per chosen Section, the count of governed elements
//     from the §30.7 ledger (listicle_section_link_instances rows + the
//     __headline__ row counts once each).
//
// The preview is CONTENT-accurate; pixel parity stays gated on the §31.0
// reference captures (Phase 6) — BLOCKER/PROVISIONAL token statuses are
// untouched, and the §30.4 Disclosure INTERACTION is deliberately not
// implemented (the trigger renders as an inert placeholder).

import {
  GOVERNED_LINK_REL,
  listicleBlocksToHtml,
  LISTICLE_HIGHLIGHTS,
  LISTICLE_TEXT_COLORS,
  offerRefString,
  type ListicleBlock,
} from "../../editor/listicle-blocks";
import { escapeHtml, isSafeUrl } from "../../editor/sanitize";
import {
  curatedColorCss,
  defaultLayoutSectionCss,
  DEFAULT_LAYOUT_SCOPE,
} from "../../public/listicle/layouts/default/tokens-to-css";
import { defaultListicleLayoutTokens } from "../../public/listicle/layouts/default/tokens";
import {
  evaluateRules,
  parseConditions,
  SET_DIMENSIONS,
  type RuleConditions,
  type RuleContext,
} from "../../listicles/rules";
import { validateByline, type BylineInput } from "../../listicles/validation";
import { chunk, placeholders, readJsonBody, type AdminContext } from "./shared";
import { loadPagesForVersions, type StructurePage } from "./structure";
import { resolveVersionRow } from "./versions-handlers";
import type { ArticleRowL, VersionRowL } from "./articles-handlers";

const T = defaultListicleLayoutTokens;

// ---------------------------------------------------------------------------
// Token → CSS for the page CHROME groups (§30.1 header / logoSlot /
// disclosureTrigger / articleTopSpacing / articleHeadline / byline /
// heroImage / legalDisclosureBlock / footer).
//
// tokens-to-css.ts owns the SECTION-content stylesheet (§30.6, reused as-is
// below); it does not export its group mapper, and it lives outside this
// phase's write boundary — so the chrome mapper is re-stated here with the
// same conventions (Desktop/Mobile suffixes, paddingX/Y expansion, meta
// fields skipped). No CSS value is hand-written where a measured token
// exists; Phase 6's styles.ts stays the authoritative full-page stylesheet.
// ---------------------------------------------------------------------------

type TokenGroup = Record<string, unknown>;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function isMetaField(name: string): boolean {
  return name === "status" || name.startsWith("measured") || name === "instruction";
}

function fieldDecls(prop: string, value: string): string[] {
  if (prop === "paddingX") return [`padding-left:${value}`, `padding-right:${value}`];
  if (prop === "paddingY") return [`padding-top:${value}`, `padding-bottom:${value}`];
  if (prop === "textColor") return [`color:${value}`];
  return [`${kebab(prop)}:${value}`];
}

function groupCss(
  selector: string,
  group: TokenGroup,
  only?: ReadonlyArray<string>,
): { base: string; mobile: string } {
  const base: string[] = [];
  const mobile: string[] = [];
  for (const [key, raw] of Object.entries(group)) {
    if (isMetaField(key) || typeof raw !== "string") continue;
    if (only !== undefined && !only.includes(key)) continue;
    if (key.endsWith("Desktop")) {
      base.push(...fieldDecls(key.slice(0, -"Desktop".length), raw));
    } else if (key.endsWith("Mobile")) {
      mobile.push(...fieldDecls(key.slice(0, -"Mobile".length), raw));
    } else {
      base.push(...fieldDecls(key, raw));
    }
  }
  return {
    base: base.length > 0 ? `${selector}{${base.join(";")}}` : "",
    mobile: mobile.length > 0 ? `${selector}{${mobile.join(";")}}` : "",
  };
}

// The §30.2 chrome stylesheet, generated from tokens. Scoped under the same
// [data-layout="default"] scope as the section stylesheet.
export function versionPreviewChromeCss(scope = DEFAULT_LAYOUT_SCOPE): string {
  const out: string[] = [];
  const mobileOut: string[] = [];
  const emit = (selector: string, group: TokenGroup, only?: ReadonlyArray<string>): void => {
    const { base, mobile } = groupCss(selector, group, only);
    if (base !== "") out.push(base);
    if (mobile !== "") mobileOut.push(mobile);
  };

  // Header — red 64px bar + bottom hairline (§30.1 header).
  emit(`${scope} .lst-header`, T.header, [
    "height",
    "backgroundColor",
    "paddingX",
    "paddingY",
    "display",
    "alignItems",
    "justifyContent",
    "boxSizing",
  ]);
  out.push(
    `${scope} .lst-header{border-bottom:${T.header.borderBottomWidth} solid ${T.header.borderBottomColor}}`,
  );

  // Logo slot — the ONLY per-host brand swap (§30.2/§30.3). The preview has
  // no host logo asset wired yet: the slot renders the site name in white.
  emit(`${scope} .lst-logo-slot`, T.logoSlot, ["widthDesktop", "heightDesktop", "display"]);
  out.push(
    `${scope} .lst-logo-slot{color:#ffffff;font-family:${T.page.fontFamily};font-weight:700;font-size:20px;line-height:${T.logoSlot.heightDesktop};overflow:hidden;white-space:nowrap;text-overflow:ellipsis}`,
    `${scope} .lst-logo-slot img{width:100%;height:100%;object-fit:${T.logoSlot.objectFit};object-position:${T.logoSlot.objectPosition};display:block}`,
  );

  // Disclosure trigger — top-right (§30.1 disclosureTrigger). INTERACTION is
  // a §30.4 BLOCKER — the preview renders an inert trigger only.
  emit(`${scope} .lst-disclosure-trigger`, T.disclosureTrigger, [
    "color",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "textDecoration",
    "cursor",
  ]);
  out.push(`${scope} .lst-disclosure-trigger{background:none;border:0;padding:0}`);

  // Article shell top spacing (§30.1 articleTopSpacing).
  emit(`${scope} .lst-article-shell`, T.articleTopSpacing, ["paddingTopDesktop", "paddingTopMobile"]);

  // Title (§30.1 articleHeadline) — centered, max-width via auto margins.
  emit(`${scope} .lst-title`, T.articleHeadline);
  out.push(`${scope} .lst-title{margin-left:auto;margin-right:auto}`);

  // Byline (§30.2/§30.1 byline): centered row · 31px circular avatar ·
  // 16px gap · 12px bold #4b5360.
  emit(`${scope} .lst-byline`, T.byline, [
    "display",
    "alignItems",
    "justifyContent",
    "gap",
    "marginBottom",
    "fontFamily",
    "fontSize",
    "lineHeight",
    "fontWeight",
  ]);
  out.push(
    `${scope} .lst-byline{color:${T.byline.color}}`,
    `${scope} .lst-byline .lst-byline-avatar{width:${T.byline.avatarSize};height:${T.byline.avatarSize};border-radius:${T.byline.avatarRadius};object-fit:cover;display:block}`,
  );

  // Hero (§30.1 heroImage).
  emit(`${scope} .lst-hero img`, T.heroImage, [
    "width",
    "aspectRatio",
    "objectFit",
    "objectPosition",
    "borderRadius",
    "marginTop",
    "marginBottom",
    "display",
  ]);

  // Intro paragraphs (§30.1 bodyParagraph — the section stylesheet covers
  // section-scoped <p>; the intro sits outside .lst-section).
  emit(`${scope} .lst-intro p`, T.bodyParagraph);

  // Legal block (§30.1 legalDisclosureBlock).
  emit(`${scope} .lst-legal`, T.legalDisclosureBlock);

  // Footer (§30.1 footer).
  emit(`${scope} .lst-footer`, T.footer, [
    "backgroundColor",
    "paddingTop",
    "paddingBottom",
    "paddingX",
  ]);
  out.push(
    `${scope} .lst-footer{border-top:${T.footer.borderTopWidth} solid ${T.footer.borderTopColor};text-align:center}`,
    `${scope} .lst-footer .lst-footer-logo{display:inline-block;width:${T.footer.footerLogoWidth};margin-bottom:${T.footer.footerLogoMarginBottom};font-weight:700;color:${T.footer.linkColor}}`,
    `${scope} .lst-footer .lst-footer-nav a{color:${T.footer.linkColor};font-size:${T.footer.linkFontSize};line-height:${T.footer.linkLineHeight};text-decoration:${T.footer.linkTextDecoration};margin:0 8px}`,
    `${scope} .lst-footer .lst-footer-nav a:hover{text-decoration:${T.footer.linkHoverTextDecoration}}`,
    `${scope} .lst-footer .lst-footer-legal{font-size:${T.footer.legalFontSize};line-height:${T.footer.legalLineHeight};color:${T.footer.legalColor};margin-top:${T.footer.legalMarginTop}}`,
    `${scope} .lst-footer .lst-footer-copyright{font-size:${T.footer.copyrightFontSize};line-height:${T.footer.copyrightLineHeight};color:${T.footer.copyrightColor};margin-top:${T.footer.copyrightMarginTop}}`,
  );

  const css = out.filter((r) => r !== "").join("\n");
  const mobileCss = mobileOut.filter((r) => r !== "").join("\n");
  return mobileCss === "" ? css : `${css}\n@media (max-width: 767px){\n${mobileCss}\n}`;
}

// ---------------------------------------------------------------------------
// Preview page model — stored Version tree with optional LIVE overrides
// ---------------------------------------------------------------------------

interface PreviewRule {
  public_id: string | null;
  priority: number;
  conditions: RuleConditions;
}

interface PreviewCandidate {
  public_id: string | null;
  section_id: number;
  label: string;
  is_fallback: boolean;
  rule: PreviewRule | null;
}

interface PreviewPage {
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  candidates: PreviewCandidate[];
}

// Lenient page parse — the preview renders MID-EDIT builder state (the same
// stance as the §30.6 Section preview): malformed candidates/rules are
// SKIPPED, never a 400. Full §23 validation stays the save gate.
function parsePreviewPages(raw: unknown): PreviewPage[] | null {
  if (!Array.isArray(raw)) return null;
  const pages: PreviewPage[] = [];
  raw.forEach((rawPage, index) => {
    if (typeof rawPage !== "object" || rawPage === null || Array.isArray(rawPage)) return;
    const page = rawPage as Record<string, unknown>;
    const pageIndex =
      typeof page.page_index === "number" && Number.isInteger(page.page_index) && page.page_index >= 0
        ? page.page_index
        : index;
    const mode = typeof page.selection_mode === "string" ? page.selection_mode : "single";
    const candidates: PreviewCandidate[] = [];
    if (Array.isArray(page.candidates)) {
      for (const rawCand of page.candidates) {
        if (typeof rawCand !== "object" || rawCand === null || Array.isArray(rawCand)) continue;
        const cand = rawCand as Record<string, unknown>;
        const sectionId =
          typeof cand.section_id === "number" && Number.isInteger(cand.section_id) && cand.section_id > 0
            ? cand.section_id
            : null;
        if (sectionId === null) continue;
        let rule: PreviewRule | null = null;
        const rawRule = cand.rule;
        if (typeof rawRule === "object" && rawRule !== null && !Array.isArray(rawRule)) {
          const r = rawRule as Record<string, unknown>;
          const parsed = parseConditions(r.conditions ?? r.conditions_json);
          if (parsed.ok && typeof r.priority === "number" && Number.isInteger(r.priority)) {
            rule = {
              public_id:
                typeof r.public_id === "string" && r.public_id.trim() !== "" ? r.public_id.trim() : null,
              priority: r.priority,
              conditions: parsed.conditions,
            };
          }
        }
        candidates.push({
          public_id:
            typeof cand.public_id === "string" && cand.public_id.trim() !== ""
              ? cand.public_id.trim()
              : null,
          section_id: sectionId,
          label: typeof cand.label === "string" && cand.label.trim() !== "" ? cand.label.trim() : "A",
          is_fallback: cand.is_fallback === true || cand.is_fallback === 1,
          rule,
        });
      }
    }
    pages.push({
      page_index: pageIndex,
      selection_mode: mode,
      ab_test_id: typeof page.ab_test_id === "string" ? page.ab_test_id : null,
      candidates,
    });
  });
  return pages;
}

function storedPagesToPreview(pages: StructurePage[]): PreviewPage[] {
  return pages.map((page) => ({
    page_index: page.page_index,
    selection_mode: page.selection_mode,
    ab_test_id: page.ab_test_id,
    candidates: page.candidates.map((cand) => {
      let rule: PreviewRule | null = null;
      if (cand.rule !== null) {
        const parsed = parseConditions(cand.rule.conditions_json);
        rule = {
          public_id: cand.rule.public_id,
          priority: cand.rule.priority,
          conditions: parsed.ok ? parsed.conditions : {},
        };
      }
      return {
        public_id: cand.public_id,
        section_id: cand.section_id,
        label: cand.label,
        is_fallback: cand.is_fallback === 1,
        rule,
      };
    }),
  }));
}

// Sanitize the simulated audience context (§15.4 set dims + hour).
export function parsePreviewContext(raw: unknown): RuleContext {
  const ctx: RuleContext = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ctx;
  const obj = raw as Record<string, unknown>;
  for (const dim of SET_DIMENSIONS) {
    const v = obj[dim];
    if (typeof v === "string" && v.trim() !== "") ctx[dim] = v.trim();
  }
  const hour = obj.hour;
  if (typeof hour === "number" && Number.isFinite(hour) && hour >= 0 && hour < 24) {
    ctx.hour = hour;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Candidate choice (§30.6 "force Version A/B + Page candidate, simulate rule
// audience dims" — rule_based via the SAME evaluation semantics as runtime)
// ---------------------------------------------------------------------------

export interface ChosenCandidate {
  candidate: PreviewCandidate;
  // §15.7 tracking reasons where they are REAL here (rule_match / fallback /
  // single_default); preview-only reasons ('forced', 'ab_first_preview')
  // where no runtime mechanism ran — the admin preview never pretends a hash
  // assignment happened.
  reason: string;
  rule_id: string | null;
}

export function choosePreviewCandidate(
  page: PreviewPage,
  ctx: RuleContext,
  forcedCandidateId: string | null,
): ChosenCandidate | null {
  const candidates = page.candidates;
  if (candidates.length === 0) return null;
  if (forcedCandidateId !== null) {
    const forced = candidates.find((cand) => cand.public_id === forcedCandidateId);
    if (forced !== undefined) {
      return { candidate: forced, reason: "forced", rule_id: forced.rule?.public_id ?? null };
    }
  }
  if (page.selection_mode === "rule_based") {
    const evaluable = candidates
      .filter((cand) => cand.rule !== null && !cand.is_fallback)
      .map((cand) => ({
        priority: (cand.rule as PreviewRule).priority,
        conditions: (cand.rule as PreviewRule).conditions,
        cand,
      }));
    const matched = evaluateRules(evaluable, ctx);
    if (matched !== null) {
      return {
        candidate: matched.cand,
        reason: "rule_match",
        rule_id: matched.cand.rule?.public_id ?? null,
      };
    }
    const fallback = candidates.find((cand) => cand.is_fallback) ?? candidates[0];
    if (fallback === undefined) return null;
    return { candidate: fallback, reason: "fallback", rule_id: null };
  }
  const first = candidates[0];
  if (first === undefined) return null;
  if (page.selection_mode === "ab_test") {
    // No session identity exists in an admin preview — the first candidate
    // renders and the reason says so honestly (force a candidate to see the
    // others). The RUNTIME pick (sticky abHash) is Phase 7.
    return { candidate: first, reason: "ab_first_preview", rule_id: null };
  }
  return { candidate: first, reason: "single_default", rule_id: null };
}

// ---------------------------------------------------------------------------
// Section + media + CTA-density loading
// ---------------------------------------------------------------------------

interface PreviewSectionRow {
  id: number;
  public_id: string;
  section_name: string;
  headline_text: string;
  headline_offer_id: number | null;
  image_json: string | null;
  content_json: string;
}

async function loadSections(
  db: D1Database,
  sectionIds: readonly number[],
): Promise<Map<number, PreviewSectionRow>> {
  const map = new Map<number, PreviewSectionRow>();
  for (const ids of chunk([...new Set(sectionIds)])) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, section_name, headline_text, headline_offer_id, image_json, content_json
         FROM listicle_sections WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<PreviewSectionRow>();
    for (const row of rows.results ?? []) map.set(row.id, row);
  }
  return map;
}

// Page CTA Density (§30.6): governed elements per Section from the §30.7
// ledger — listicle_section_link_instances rows (headline / inline / button /
// choice_button / final_text_cta / linked_image roles, incl. the
// __headline__ row).
async function loadCtaDensities(
  db: D1Database,
  sectionIds: readonly number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const ids of chunk([...new Set(sectionIds)])) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT section_id, COUNT(*) AS n FROM listicle_section_link_instances
         WHERE section_id IN (${placeholders(ids.length)}) GROUP BY section_id`,
      )
      .bind(...ids)
      .all<{ section_id: number; n: number }>();
    for (const row of rows.results ?? []) map.set(row.section_id, Number(row.n));
  }
  return map;
}

async function resolveMediaUrl(db: D1Database, mediaId: number | null): Promise<string | null> {
  if (mediaId === null) return null;
  const row = await db
    .prepare("SELECT storage_key FROM media WHERE id = ? LIMIT 1")
    .bind(mediaId)
    .first<{ storage_key: string }>();
  return row?.storage_key ? `/media/${row.storage_key}` : null;
}

// ---------------------------------------------------------------------------
// Document render (§30.2 component order)
// ---------------------------------------------------------------------------

interface SectionImage {
  url?: string;
}

function sectionImageUrl(imageJson: string | null): string {
  if (imageJson === null || imageJson.trim() === "") return "";
  try {
    const parsed = JSON.parse(imageJson) as SectionImage;
    return typeof parsed.url === "string" ? parsed.url : "";
  } catch {
    return "";
  }
}

function renderSectionHtml(section: PreviewSectionRow): string {
  const headlineText = escapeHtml(section.headline_text);
  const headlineOffer = offerRefString(section.headline_offer_id);
  const headlineInner =
    headlineOffer === ""
      ? headlineText
      : `<a data-offer="${escapeHtml(headlineOffer)}" data-block-id="__headline__" data-link-role="headline" rel="${GOVERNED_LINK_REL}">${headlineText}</a>`;
  const headlineHtml = section.headline_text === "" ? "" : `<h2>${headlineInner}</h2>`;
  const imgUrl = sectionImageUrl(section.image_json);
  const imageHtml =
    imgUrl === "" || !isSafeUrl(imgUrl)
      ? ""
      : `<div class="lst-img"><img src="${escapeHtml(imgUrl)}" alt="" loading="lazy" /></div>`;
  let blocks: ListicleBlock[] = [];
  try {
    const doc = JSON.parse(section.content_json) as { blocks?: ListicleBlock[] };
    if (Array.isArray(doc.blocks)) blocks = doc.blocks;
  } catch {
    blocks = [];
  }
  return `${headlineHtml}${imageHtml}${listicleBlocksToHtml({ blocks })}`;
}

function renderBylineHtml(byline: BylineInput | null): string {
  if (byline === null || !byline.enabled) return "";
  const avatarUrl = byline.author_avatar_url ?? "";
  const avatar =
    avatarUrl !== "" && isSafeUrl(avatarUrl)
      ? `<img class="lst-byline-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(byline.author_name)}" />`
      : "";
  const parts: string[] = [];
  const label = byline.label.trim();
  if (label !== "") parts.push(escapeHtml(label));
  if (byline.author_name.trim() !== "") parts.push(`By ${escapeHtml(byline.author_name)}`);
  const updated = `${byline.updated_label} ${byline.updated_date}`.trim();
  if (updated !== "") parts.push(escapeHtml(updated));
  return `<div class="lst-byline">${avatar}<span class="lst-byline-text">${parts.join(" · ")}</span></div>`;
}

export interface PreviewPageResult {
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  chosen_candidate_id: string | null;
  chosen_section_id: number | null;
  chosen_section_name: string;
  selection_reason: string;
  rule_id: string | null;
  cta_density: number;
}

export interface VersionPreviewDocumentInput {
  siteName: string;
  headline: string;
  introParagraph: string;
  heroUrl: string | null;
  byline: BylineInput | null;
  pages: ReadonlyArray<{ result: PreviewPageResult; sectionHtml: string }>;
}

export function renderVersionPreviewDocument(input: VersionPreviewDocumentInput): string {
  const css = [
    "html,body{margin:0;padding:0}",
    versionPreviewChromeCss(),
    defaultLayoutSectionCss(),
    curatedColorCss({ textColors: LISTICLE_TEXT_COLORS, highlights: LISTICLE_HIGHLIGHTS }),
  ].join("\n");

  const heroHtml =
    input.heroUrl !== null && input.heroUrl !== "" && isSafeUrl(input.heroUrl)
      ? `<div class="lst-hero"><img src="${escapeHtml(input.heroUrl)}" alt="" /></div>`
      : "";

  const introHtml = input.introParagraph
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  const pagesHtml = input.pages
    .map(({ result, sectionHtml }) => {
      return `<div class="lst-page" data-page-index="${result.page_index}" data-selection-mode="${escapeHtml(result.selection_mode)}" data-cand="${escapeHtml(result.chosen_candidate_id ?? "")}" data-selection-reason="${escapeHtml(result.selection_reason)}" data-cta-density="${result.cta_density}">
<section class="lst-section">${sectionHtml}</section>
</div>`;
    })
    .join("\n");

  // §30.2 order: Header (logo + Disclosure) → ArticleShell (title, byline,
  // hero, intro, OfferSections[]) → LegalDisclosureBlock → Footer.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Version preview</title>
<style>${css}</style>
</head>
<body data-layout="default">
<header class="lst-header">
  <span class="lst-logo-slot">${escapeHtml(input.siteName)}</span>
  <button type="button" class="lst-disclosure-trigger" title="Disclosure interaction is a §30.4 BLOCKER — measured in Phase 6">Advertiser Disclosure</button>
</header>
<div class="lst-container">
<article class="lst-article-shell">
  <h1 class="lst-title">${escapeHtml(input.headline)}</h1>
  ${renderBylineHtml(input.byline)}
  ${heroHtml}
  <div class="lst-intro">${introHtml}</div>
  ${pagesHtml}
</article>
</div>
<div class="lst-legal" data-lst-binding="default.legalDisclosureBlock">This is an advertisement. The content above is a paid placement — the legal disclosure copy is wired to site settings in Phase 6.</div>
<footer class="lst-footer">
  <span class="lst-footer-logo">${escapeHtml(input.siteName)}</span>
  <nav class="lst-footer-nav"><a>Privacy Policy</a><a>Terms of Use</a><a>Contact</a></nav>
  <p class="lst-footer-legal">Offers shown are from partners who compensate us; compensation may impact how and where offers appear.</p>
  <p class="lst-footer-copyright">© ${new Date().getUTCFullYear()} ${escapeHtml(input.siteName)}</p>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler — POST /api/admin/listicles/versions/:id/preview
// ---------------------------------------------------------------------------

function parseBylineForPreview(raw: unknown, stored: string | null): BylineInput | null {
  // Live override wins; invalid live byline degrades to none (a preview never
  // 400s over mid-edit state). Absent override ⇒ the stored byline.
  const source = raw !== undefined ? raw : stored;
  const parsed = validateByline(source);
  if (parsed.json === null) return null;
  return JSON.parse(parsed.json) as BylineInput;
}

export async function versionPreviewHandler(c: AdminContext): Promise<Response> {
  const version = await resolveVersionRow(c.env.DB, c.req.param("id") ?? "");
  if (version === null) return c.json({ error: "Not Found" }, 404);
  const article = await c.env.DB.prepare("SELECT * FROM listicle_articles WHERE id = ? LIMIT 1")
    .bind(version.article_id)
    .first<ArticleRowL>();
  if (!article) return c.json({ error: "Not Found" }, 404);
  const site = await c.env.DB.prepare("SELECT id, name FROM sites WHERE id = ? LIMIT 1")
    .bind(article.site_id)
    .first<{ id: string; name: string | null }>();

  const body = (await readJsonBody(c)) ?? {};
  const override =
    typeof body.version === "object" && body.version !== null && !Array.isArray(body.version)
      ? (body.version as Record<string, unknown>)
      : null;

  // Effective version fields: live override (the ACTIVE builder version) or
  // the stored row (forcing any OTHER Version).
  const effective: Pick<
    VersionRowL,
    "headline" | "intro_paragraph" | "hero_media_id" | "hero_media_url" | "layout_style_id"
  > = {
    headline:
      override !== null && typeof override.headline === "string" && override.headline.trim() !== ""
        ? override.headline
        : version.headline,
    intro_paragraph:
      override !== null && typeof override.intro_paragraph === "string"
        ? override.intro_paragraph
        : version.intro_paragraph,
    hero_media_id:
      override !== null && typeof override.hero_media_id === "number"
        ? override.hero_media_id
        : version.hero_media_id,
    hero_media_url:
      override !== null && typeof override.hero_media_url === "string" && override.hero_media_url !== ""
        ? override.hero_media_url
        : version.hero_media_url,
    layout_style_id: version.layout_style_id,
  };

  let pages: PreviewPage[] | null = override !== null ? parsePreviewPages(override.pages) : null;
  if (pages === null) {
    pages = storedPagesToPreview(
      (await loadPagesForVersions(c.env.DB, [version.id])).get(version.id) ?? [],
    );
  }
  pages.sort((a, b) => a.page_index - b.page_index);

  const ctx = parsePreviewContext(body.ctx);
  const forcedRaw =
    typeof body.force_candidates === "object" && body.force_candidates !== null && !Array.isArray(body.force_candidates)
      ? (body.force_candidates as Record<string, unknown>)
      : {};

  const sectionIds = pages.flatMap((page) => page.candidates.map((cand) => cand.section_id));
  const sections = await loadSections(c.env.DB, sectionIds);
  const densities = await loadCtaDensities(c.env.DB, sectionIds);

  const pageOutputs: Array<{ result: PreviewPageResult; sectionHtml: string }> = [];
  for (const page of pages) {
    const forcedValue = forcedRaw[String(page.page_index)];
    const forced = typeof forcedValue === "string" && forcedValue.trim() !== "" ? forcedValue.trim() : null;
    const chosen = choosePreviewCandidate(page, ctx, forced);
    if (chosen === null) {
      pageOutputs.push({
        result: {
          page_index: page.page_index,
          selection_mode: page.selection_mode,
          ab_test_id: page.ab_test_id,
          chosen_candidate_id: null,
          chosen_section_id: null,
          chosen_section_name: "",
          selection_reason: "empty_page",
          rule_id: null,
          cta_density: 0,
        },
        sectionHtml: `<p class="lst-preview-empty">This page has no Section candidates yet.</p>`,
      });
      continue;
    }
    const section = sections.get(chosen.candidate.section_id);
    pageOutputs.push({
      result: {
        page_index: page.page_index,
        selection_mode: page.selection_mode,
        ab_test_id: page.ab_test_id,
        chosen_candidate_id: chosen.candidate.public_id,
        chosen_section_id: chosen.candidate.section_id,
        chosen_section_name: section?.section_name ?? "",
        selection_reason: chosen.reason,
        rule_id: chosen.rule_id,
        cta_density: densities.get(chosen.candidate.section_id) ?? 0,
      },
      sectionHtml: section
        ? renderSectionHtml(section)
        : `<p class="lst-preview-empty">Unknown section ${chosen.candidate.section_id}.</p>`,
    });
  }

  let heroUrl = effective.hero_media_url;
  if ((heroUrl === null || heroUrl === "") && effective.hero_media_id !== null) {
    heroUrl = await resolveMediaUrl(c.env.DB, effective.hero_media_id);
  }
  let byline: BylineInput | null = null;
  try {
    byline = parseBylineForPreview(
      override !== null ? override.byline ?? override.byline_json : undefined,
      version.byline_json,
    );
  } catch {
    byline = null;
  }

  const html = renderVersionPreviewDocument({
    siteName: site?.name?.trim() !== "" && site?.name != null ? site.name : article.site_id,
    headline: effective.headline,
    introParagraph: effective.intro_paragraph,
    heroUrl,
    byline,
    pages: pageOutputs,
  });

  return c.json({
    html,
    lander_v: version.public_id,
    content_version: version.content_version,
    pages: pageOutputs.map((p) => p.result),
  });
}
