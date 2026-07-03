// Section preview document (design contract §30.6).
//
// Renders a Section — headline (linked when governed), image, and its blocks
// through the LISTICLE renderers — inside the real default-layout
// SectionWrapper, styled by the token-GENERATED stylesheet
// (public/listicle/layouts/default/tokens-to-css.ts). Served by
// POST /api/admin/listicles/sections/preview into the editor's preview
// iframe (srcdoc), desktop/mobile toggled by iframe width client-side.
//
// The preview is CONTENT-accurate; pixel parity stays gated on the §31.0
// captures (Phase 6) — PROVISIONAL/BLOCKER token statuses are untouched.

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
} from "../../public/listicle/layouts/default/tokens-to-css";

export interface SectionPreviewInput {
  headline_text: string;
  headline_offer_id: unknown; // off_… string or legacy numeric id
  headline_link_instance_id?: string;
  image_url: string | null;
  blocks: ListicleBlock[];
}

// Preview scaffold only (iframe reset + toggle affordance) — every content
// rule comes from the token-generated stylesheet, never hand-written here.
const PREVIEW_SCAFFOLD_CSS = "html,body{margin:0;padding:0}";

export function renderSectionPreviewDocument(input: SectionPreviewInput): string {
  const css =
    PREVIEW_SCAFFOLD_CSS +
    "\n" +
    defaultLayoutSectionCss() +
    "\n" +
    curatedColorCss({ textColors: LISTICLE_TEXT_COLORS, highlights: LISTICLE_HIGHLIGHTS });

  const headlineText = escapeHtml(input.headline_text);
  const headlineOffer = offerRefString(input.headline_offer_id);
  const headlineInner =
    headlineOffer === ""
      ? headlineText
      : `<a data-offer="${escapeHtml(headlineOffer)}" data-link-instance="${escapeHtml(
          input.headline_link_instance_id ?? "",
        )}" data-block-id="__headline__" data-link-role="headline" rel="${GOVERNED_LINK_REL}">${headlineText}</a>`;
  const headlineHtml = input.headline_text === "" ? "" : `<h2>${headlineInner}</h2>`;

  // The src rides the same URL-protocol allowlist as renderLinkedImage —
  // an unsafe scheme (javascript:/data:/…) omits the image entirely.
  const imageHtml =
    input.image_url === null || input.image_url === "" || !isSafeUrl(input.image_url)
      ? ""
      : `<div class="lst-img"><img src="${escapeHtml(input.image_url)}" alt="" loading="lazy" /></div>`;

  const contentHtml = listicleBlocksToHtml({ blocks: input.blocks });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Section preview</title>
<style>${css}</style>
</head>
<body data-layout="default">
<div class="lst-container">
<section class="lst-section">
${headlineHtml}
${imageHtml}
${contentHtml}
</section>
</div>
</body>
</html>`;
}
