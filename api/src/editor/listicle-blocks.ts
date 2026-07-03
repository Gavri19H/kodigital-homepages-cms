// Listicle block grammar — server side (design contract §12 + §30.5 + §30.9).
//
// EXTENDS the existing block editor machinery (./blocks.ts renderers +
// ./sanitize.ts tag-whitelist) with the listicle-scoped governed vocabulary:
//
//   * `button`               {text, style, align, offer_id}            (§12)
//   * `choice_button_group`  {layout_binding, prompt?, items[]}        (§30.5)
//   * `final_text_cta`       {link_instance_id, text, offer_id, …}     (§30.5)
//   * `linked_image`         {media_id?/image_url?, alt, offer_id, …}  (§30.5)
//   * `spacer`               (Reference Spacer / Gap preset)           (§30.5)
//   * `list` gains `marker: disc|dash|ordered|check|emoji` (+`emoji`)  (§12)
//   * inline `offerlink` mark `<a data-offer="off_…">` — NO href stored (§12)
//   * curated text-colour / highlight tokens on <span data-lst-color…> (§12)
//
// Governed anchors emit data-offer + data-link-instance + data-block-id +
// data-link-role and rel="sponsored nofollow noopener" — and NO href: the
// live Article renderer alone mints /lc URLs at render time (§12, Phase 6/7).
//
// This module is ADDITIVE: nothing here is imported by the homepage-article
// pipeline, and ./blocks.ts / ./sanitize.ts are untouched, so the existing
// `affiliate`/homepage editor behavior stays byte-identical (pillar 1).

import { escapeHtml, isSafeUrl, sanitizeHtml } from "./sanitize";
import { renderBlock, type BaseBlock } from "./blocks";
import { defaultListicleLayoutTokens } from "../public/listicle/layouts/default/tokens";

export const GOVERNED_LINK_REL = "sponsored nofollow noopener";

// ---------------------------------------------------------------------------
// Curated tokens (§12 "Text colour · Background/highlight (curated tokens)")
// ---------------------------------------------------------------------------
// Text colours are derived 1:1 from the §30.1 measured token package — never
// hand-written duplicates. Highlights: `brandTint` is token-derived; `sun` and
// `mint` are authored curation (§12 names no highlight palette; two neutral
// marker tones keep the set small).

const T = defaultListicleLayoutTokens;

export const LISTICLE_TEXT_COLORS: Readonly<Record<string, string>> = {
  body: T.page.textColor, // #2a2a2a
  brand: T.inlineLink.color, // #ce2e35
  brandDark: T.inlineLink.hoverColor, // #b9272e
  muted: T.byline.color, // #4b5360
  legal: T.legalDisclosureBlock.color, // #4b4b4b
  inverse: T.choiceButton.color, // #ffffff
};

export const LISTICLE_HIGHLIGHTS: Readonly<Record<string, string>> = {
  brandTint: T.header.borderBottomColor, // #f4d1d3
  sun: "#fff3c4",
  mint: "#e2f5e6",
};

// Curated emoji set (§12 "Emoji library" + list `emoji` marker; §28 Q10 keeps
// full emoji/GIF pickers out of v1 — a small curated const, no npm dep).
export const LISTICLE_EMOJI_SET: ReadonlyArray<string> = [
  "✅", "✔️", "☑️", "⭐", "🌟", "💡", "🔥", "🎯", "🏆", "💰",
  "💵", "💳", "📈", "📉", "🛒", "🏠", "🚗", "🐶", "🐱", "❤️",
  "👍", "👉", "👇", "⚠️", "⏰", "🎁", "🔒", "🛡️", "✨", "🙌",
  "😊", "🤔", "💪", "📣", "📞", "✉️", "📌", "❌", "❓", "➡️",
];

export const LISTICLE_LIST_MARKERS = ["disc", "dash", "ordered", "check", "emoji"] as const;
export type ListicleListMarker = (typeof LISTICLE_LIST_MARKERS)[number];

// Marker glyphs come from the §30.1 listBlock tokens where measured.
export const LIST_MARKER_GLYPHS: Readonly<Record<string, string>> = {
  disc: T.listBlock.bulletMarker, // "• "
  dash: "– ",
  check: T.listBlock.checkmarkMarker, // "✔️ "
};

export const LISTICLE_BUTTON_STYLES = ["primary", "outline"] as const;
export const LISTICLE_BUTTON_ALIGNS = ["left", "center", "right"] as const;

// The listicle Section vocabulary (§12 grammar). `affiliate` (free-text URL)
// and raw `html` blocks are NOT part of it — validation rejects them.
export const LISTICLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "list",
  "quote",
  "image",
  "divider",
  "pullquote",
  "callout",
  "faqgroup",
  "button",
  "choice_button_group",
  "final_text_cta",
  "linked_image",
  "spacer",
]);

export function isListicleBlockType(type: string): boolean {
  return LISTICLE_BLOCK_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// §30.5 reference presets — each carries its layout_binding to §30.1 tokens
// ---------------------------------------------------------------------------

export interface ListicleReferencePreset {
  key: string;
  label: string;
  layout_binding: string;
  /** true ⇒ inserting the preset first opens the §13 Offer modal */
  needs_offer: boolean;
  /** block factory shape ({type, data}) the editor inserts */
  block: { type: string; data: Record<string, unknown> };
}

export const LISTICLE_REFERENCE_PRESETS: ReadonlyArray<ListicleReferencePreset> = [
  {
    key: "reference-section-heading",
    label: "Reference Section Heading",
    layout_binding: "default.sectionHeading",
    needs_offer: false,
    block: { type: "heading", data: { level: 2, text: "", layout_binding: "default.sectionHeading" } },
  },
  {
    key: "reference-linked-section-heading",
    label: "Reference Linked Section Heading",
    layout_binding: "default.sectionHeading",
    needs_offer: true,
    block: {
      type: "heading",
      data: { level: 2, text: "", offer_id: "", link_instance_id: "", layout_binding: "default.sectionHeading" },
    },
  },
  {
    key: "reference-linked-image",
    label: "Reference Linked Image",
    layout_binding: "default.sectionImage",
    needs_offer: true,
    // §30.5 LinkedImageBlock data shape, verbatim keys.
    block: {
      type: "linked_image",
      data: { image_url: "", alt: "", offer_id: "", link_instance_id: "", layout_binding: "default.sectionImage" },
    },
  },
  {
    key: "reference-paragraph",
    label: "Reference Paragraph",
    layout_binding: "default.bodyParagraph",
    needs_offer: false,
    block: { type: "paragraph", data: { text: "", layout_binding: "default.bodyParagraph" } },
  },
  {
    key: "reference-strong-text",
    label: "Reference Strong Text",
    layout_binding: "default.strongText",
    needs_offer: false,
    block: {
      type: "paragraph",
      data: {
        text: "Strong text",
        html: "<strong>Strong text</strong>",
        layout_binding: "default.strongText",
      },
    },
  },
  {
    key: "reference-inline-offer-link",
    label: "Reference Inline Offer Link",
    layout_binding: "default.inlineLink",
    needs_offer: true,
    block: { type: "paragraph", data: { text: "", layout_binding: "default.inlineLink" } },
  },
  {
    key: "reference-qualification-heading",
    label: "Reference Qualification Heading",
    layout_binding: "default.sectionHeading",
    needs_offer: false,
    block: { type: "heading", data: { level: 3, text: "", layout_binding: "default.sectionHeading" } },
  },
  {
    key: "reference-step-text",
    label: "Reference Step Text",
    layout_binding: "default.bodyParagraph",
    needs_offer: false,
    block: { type: "paragraph", data: { text: "", layout_binding: "default.bodyParagraph" } },
  },
  {
    key: "reference-question-prompt",
    label: "Reference Question Prompt",
    layout_binding: "default.bodyParagraph",
    needs_offer: false,
    block: {
      type: "paragraph",
      data: {
        text: "Which option fits you best?",
        html: "<strong>Which option fits you best?</strong>",
        layout_binding: "default.bodyParagraph",
      },
    },
  },
  {
    key: "reference-choice-button-group",
    label: "Reference Choice Button Group",
    layout_binding: "default.choiceButtonGroup",
    needs_offer: true,
    // §30.5 ChoiceButtonGroupBlock data shape.
    block: {
      type: "choice_button_group",
      data: { layout_binding: "default.choiceButtonGroup", prompt: "", items: [] },
    },
  },
  {
    key: "reference-choice-button",
    label: "Reference Choice Button",
    layout_binding: "default.choiceButton",
    needs_offer: true,
    // Appends a ChoiceButtonItem to the focused/nearest group (the client
    // editor special-cases this key); the factory is the item template.
    block: {
      type: "choice_button_item",
      data: {
        text: "",
        offer_id: "",
        link_instance_id: "",
        style_id: "reference-choice-button",
        layout_binding: "default.choiceButton",
      },
    },
  },
  {
    key: "reference-checkmark-list",
    label: "Reference Checkmark List",
    layout_binding: "default.listBlock",
    needs_offer: false,
    block: {
      type: "list",
      data: { style: "unordered", marker: "check", items: [""], layout_binding: "default.listBlock" },
    },
  },
  {
    key: "reference-bullet-list",
    label: "Reference Bullet List",
    layout_binding: "default.listBlock",
    needs_offer: false,
    block: {
      type: "list",
      data: { style: "unordered", marker: "disc", items: [""], layout_binding: "default.listBlock" },
    },
  },
  {
    key: "reference-disclaimer-paragraph",
    label: "Reference Disclaimer Paragraph",
    layout_binding: "default.legalDisclosureBlock",
    needs_offer: false,
    block: { type: "paragraph", data: { text: "", layout_binding: "default.legalDisclosureBlock" } },
  },
  {
    key: "reference-final-text-cta",
    label: "Reference Final Text CTA",
    layout_binding: "default.textCta",
    needs_offer: true,
    // §30.5 FinalTextCtaBlock data shape.
    block: {
      type: "final_text_cta",
      data: { link_instance_id: "", text: "", offer_id: "", layout_binding: "default.textCta" },
    },
  },
  {
    key: "reference-legal-disclosure",
    label: "Reference Legal Disclosure",
    layout_binding: "default.legalDisclosureBlock",
    needs_offer: false,
    block: { type: "paragraph", data: { text: "", layout_binding: "default.legalDisclosureBlock" } },
  },
  {
    key: "reference-spacer",
    label: "Reference Spacer / Gap",
    layout_binding: "default.sectionWrapper",
    needs_offer: false,
    block: { type: "spacer", data: { layout_binding: "default.sectionWrapper" } },
  },
];

// ---------------------------------------------------------------------------
// Shared value readers
// ---------------------------------------------------------------------------

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// An offer reference in listicle content is either the off_… public id
// (§30.5 shapes store strings) or a legacy internal integer id (Phase-2 API
// writes). Render as the string form; enrichment normalizes ids on save.
export function offerRefString(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return String(value);
  return "";
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

// Attribute bundle every governed anchor carries (§30.7 anchor contract),
// in a fixed emission order so output is deterministic and testable.
interface GovernedAnchorAttrs {
  offer: string;
  linkInstance: string;
  blockId: string;
  role: string;
  buttonStyle?: string;
  analyticsLabel?: string;
}

function governedAttrs(a: GovernedAnchorAttrs): string {
  let out =
    ` data-offer="${escapeAttribute(a.offer)}"` +
    ` data-link-instance="${escapeAttribute(a.linkInstance)}"` +
    ` data-block-id="${escapeAttribute(a.blockId)}"` +
    ` data-link-role="${escapeAttribute(a.role)}"`;
  if (a.buttonStyle !== undefined && a.buttonStyle !== "") {
    out += ` data-btn-style="${escapeAttribute(a.buttonStyle)}"`;
  }
  if (a.analyticsLabel !== undefined && a.analyticsLabel !== "") {
    out += ` data-analytics-label="${escapeAttribute(a.analyticsLabel)}"`;
  }
  out += ` rel="${GOVERNED_LINK_REL}"`;
  return out;
}

// ---------------------------------------------------------------------------
// Inline HTML: sanitize + govern (§12 offerlink mark + curated colour spans)
// ---------------------------------------------------------------------------
//
// Pipeline: the EXISTING tag-whitelist sanitizer first (null bytes, entity
// decode, dangerous tags, on*, unsafe URLs — L-054/L-070 hard rules), then a
// listicle pass that (a) restricts inline markup to the listicle inline set,
// (b) rewrites governed anchors to EXACTLY the §30.7 attribute bundle (any
// href is dropped — no URL is ever stored), (c) unwraps ungoverned anchors,
// (d) keeps only curated data-lst-color / data-lst-highlight span tokens.

const INLINE_ALLOWED_SIMPLE = new Set(["strong", "b", "em", "i", "br"]);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = attrs.match(re);
  if (!m) return null;
  return (m[2] ?? m[3] ?? "").trim();
}

export interface InlineGovernContext {
  blockId: string;
}

// Sanitize a block's inline HTML for listicle storage/rendering. Governed
// anchors keep their data-link-instance value (written into the stored html
// by the save pipeline's link-instance enrichment — link-instances.ts).
export function governInlineHtml(html: string, ctx: InlineGovernContext): string {
  const safe = sanitizeHtml(asString(html));
  let anchorDepth = 0;
  return safe.replace(TAG_RE, (whole, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    const closing = whole.startsWith("</");
    if (INLINE_ALLOWED_SIMPLE.has(tag)) {
      // Simple marks carry no attributes.
      if (tag === "br") return "<br />";
      return closing ? `</${tag}>` : `<${tag}>`;
    }
    if (tag === "span") {
      if (closing) return "</span>";
      const color = attrValue(rawAttrs, "data-lst-color");
      const highlight = attrValue(rawAttrs, "data-lst-highlight");
      let attrs = "";
      if (color !== null && LISTICLE_TEXT_COLORS[color] !== undefined) {
        attrs += ` data-lst-color="${escapeAttribute(color)}"`;
      }
      if (highlight !== null && LISTICLE_HIGHLIGHTS[highlight] !== undefined) {
        attrs += ` data-lst-highlight="${escapeAttribute(highlight)}"`;
      }
      return `<span${attrs}>`;
    }
    if (tag === "a") {
      if (closing) {
        if (anchorDepth > 0) {
          anchorDepth--;
          return "</a>";
        }
        return "";
      }
      const offer = attrValue(rawAttrs, "data-offer");
      if (offer === null || offer === "") {
        // Ungoverned anchor: unwrap (keep inner text, drop the tag).
        return "";
      }
      const linkInstance = attrValue(rawAttrs, "data-link-instance") ?? "";
      anchorDepth++;
      return `<a${governedAttrs({
        offer,
        linkInstance,
        blockId: ctx.blockId,
        role: "inline",
      })}>`;
    }
    // Any other tag: unwrap.
    return "";
  });
}

// ---------------------------------------------------------------------------
// Block renderers (listicle vocabulary)
// ---------------------------------------------------------------------------

export interface ListicleBlock extends BaseBlock {
  id?: string;
}

function blockDomId(block: ListicleBlock, index: number): string {
  const id = typeof block.id === "string" && block.id.trim() !== "" ? block.id.trim() : "";
  if (id !== "") return id;
  const dataId = asString((block.data ?? {}).id).trim();
  return dataId !== "" ? dataId : `blk_${index}`;
}

function bindingAttr(data: Record<string, unknown>): string {
  const binding = asString(data.layout_binding).trim();
  return binding === "" ? "" : ` data-lst-binding="${escapeAttribute(binding)}"`;
}

function renderListicleParagraph(data: Record<string, unknown>, blockId: string): string {
  const html = asString(data.html).trim();
  const body =
    html !== ""
      ? governInlineHtml(html, { blockId })
      : escapeHtml(asString(data.text));
  return `<p${bindingAttr(data)} data-block-id="${escapeAttribute(blockId)}">${body}</p>`;
}

function renderListicleHeading(data: Record<string, unknown>, blockId: string): string {
  const rawLevel = typeof data.level === "number" && Number.isFinite(data.level) ? data.level : 2;
  const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));
  const html = asString(data.html).trim();
  let body =
    html !== ""
      ? governInlineHtml(html, { blockId })
      : escapeHtml(asString(data.text));
  const offer = offerRefString(data.offer_id);
  if (offer !== "") {
    // §30.2 LinkedSectionHeading: the heading text is one governed link.
    body = `<a${governedAttrs({
      offer,
      linkInstance: asString(data.link_instance_id),
      blockId,
      role: "inline",
    })}>${body}</a>`;
  }
  return `<h${level}${bindingAttr(data)} data-block-id="${escapeAttribute(blockId)}">${body}</h${level}>`;
}

const INLINE_ITEM_TAG_RE = /<\/?(?:strong|b|em|i|a|br|span)(?:\s|\/?>)/i;

function renderListicleList(data: Record<string, unknown>, blockId: string): string {
  const marker = asString(data.marker).trim() || (asString(data.style) === "ordered" ? "ordered" : "disc");
  const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  const emoji = asString(data.emoji).trim();
  const glyph =
    marker === "emoji"
      ? (emoji !== "" ? `${emoji} ` : LIST_MARKER_GLYPHS.disc ?? "")
      : LIST_MARKER_GLYPHS[marker] ?? "";
  const li = items
    .map((item) => {
      const raw = asString(item);
      const body = INLINE_ITEM_TAG_RE.test(raw)
        ? governInlineHtml(raw, { blockId })
        : escapeHtml(raw);
      const markerHtml =
        marker === "ordered" ? "" : `<span class="lst-marker" aria-hidden="true">${escapeHtml(glyph)}</span>`;
      return `<li>${markerHtml}${body}</li>`;
    })
    .join("");
  const tag = marker === "ordered" ? "ol" : "ul";
  return `<${tag} class="lst-list" data-marker="${escapeAttribute(marker)}"${bindingAttr(data)} data-block-id="${escapeAttribute(blockId)}">${li}</${tag}>`;
}

function renderListicleButton(data: Record<string, unknown>, blockId: string): string {
  const text = asString(data.text).trim();
  const offer = offerRefString(data.offer_id);
  if (text === "" || offer === "") return "";
  const style = (LISTICLE_BUTTON_STYLES as readonly string[]).includes(asString(data.style))
    ? asString(data.style)
    : "primary";
  const align = (LISTICLE_BUTTON_ALIGNS as readonly string[]).includes(asString(data.align))
    ? asString(data.align)
    : "center";
  const anchor = `<a class="lst-btn"${governedAttrs({
    offer,
    linkInstance: asString(data.link_instance_id),
    blockId,
    role: "button",
    buttonStyle: style,
    analyticsLabel: asString(data.analytics_label).trim() || undefined,
  })}>${escapeHtml(text)}</a>`;
  return `<div class="lst-btn-row" data-align="${escapeAttribute(align)}" data-block-id="${escapeAttribute(blockId)}">${anchor}</div>`;
}

function renderChoiceButtonGroup(data: Record<string, unknown>, blockId: string): string {
  const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  const prompt = asString(data.prompt).trim();
  const promptHtml =
    prompt === "" ? "" : `<p class="lst-choice-prompt">${escapeHtml(prompt)}</p>`;
  const buttons = items
    .map((raw) => {
      if (!isRecord(raw)) return "";
      const text = asString(raw.text).trim();
      const offer = offerRefString(raw.offer_id);
      if (text === "" || offer === "") return "";
      return `<a class="lst-choice-btn"${governedAttrs({
        offer,
        linkInstance: asString(raw.link_instance_id),
        blockId,
        role: "choice_button",
        buttonStyle: asString(raw.style_id).trim() || "reference-choice-button",
        analyticsLabel: asString(raw.analytics_label).trim() || undefined,
      })}>${escapeHtml(text)}</a>`;
    })
    .join("");
  if (buttons === "" && promptHtml === "") return "";
  return `<div class="lst-choice-group"${bindingAttr(data)} data-block-id="${escapeAttribute(blockId)}">${promptHtml}${buttons}</div>`;
}

function renderFinalTextCta(data: Record<string, unknown>, blockId: string): string {
  const text = asString(data.text).trim();
  const offer = offerRefString(data.offer_id);
  if (text === "" || offer === "") return "";
  const anchor = `<a${governedAttrs({
    offer,
    linkInstance: asString(data.link_instance_id),
    blockId,
    role: "final_text_cta",
    analyticsLabel: asString(data.analytics_label).trim() || undefined,
  })}>${escapeHtml(text)}</a>`;
  return `<p class="lst-final-cta"${bindingAttr(data)} data-block-id="${escapeAttribute(blockId)}">${anchor}</p>`;
}

function renderLinkedImage(data: Record<string, unknown>, blockId: string): string {
  const src = asString(data.image_url).trim() || asString(data.url).trim();
  const offer = offerRefString(data.offer_id);
  if (src === "" || offer === "" || !isSafeUrl(src)) return "";
  const alt = escapeHtml(asString(data.alt));
  const img = `<img src="${escapeAttribute(src)}" alt="${alt}" loading="lazy" />`;
  return `<a class="lst-linked-img"${governedAttrs({
    offer,
    linkInstance: asString(data.link_instance_id),
    blockId,
    role: "linked_image",
  })}${bindingAttr(data)}>${img}</a>`;
}

function renderSpacer(data: Record<string, unknown>, blockId: string): string {
  return `<div class="lst-spacer"${bindingAttr(data)} data-block-id="${escapeAttribute(blockId)}" aria-hidden="true"></div>`;
}

// Render ONE listicle block. Listicle-specific types render here; base types
// take the listicle path only when they carry listicle features (a
// layout_binding, a governed offer binding, inline html, or a list marker) —
// plain text blocks delegate BYTE-IDENTICALLY to the EXISTING renderer
// (./blocks.ts), so legacy-shaped content renders exactly as before.
export function renderListicleBlock(block: ListicleBlock, index = 0): string {
  const data = (block.data ?? {}) as Record<string, unknown>;
  const blockId = blockDomId(block, index);
  const hasBinding = asString(data.layout_binding).trim() !== "";
  const hasInlineHtml = asString(data.html).trim() !== "";
  switch (block.type) {
    case "button":
      return renderListicleButton(data, blockId);
    case "choice_button_group":
      return renderChoiceButtonGroup(data, blockId);
    case "final_text_cta":
      return renderFinalTextCta(data, blockId);
    case "linked_image":
      return renderLinkedImage(data, blockId);
    case "spacer":
      return renderSpacer(data, blockId);
    case "list": {
      const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
      const itemsHaveInlineTags = items.some(
        (item) => typeof item === "string" && INLINE_ITEM_TAG_RE.test(item),
      );
      if (asString(data.marker).trim() !== "" || hasBinding || itemsHaveInlineTags) {
        return renderListicleList(data, blockId);
      }
      return renderBlock(block);
    }
    case "paragraph":
      if (hasBinding || hasInlineHtml) {
        return renderListicleParagraph(data, blockId);
      }
      return renderBlock(block);
    case "heading":
      if (hasBinding || hasInlineHtml || offerRefString(data.offer_id) !== "") {
        return renderListicleHeading(data, blockId);
      }
      return renderBlock(block);
    default:
      return renderBlock(block);
  }
}

export interface ListicleDocument {
  version?: number;
  blocks: ListicleBlock[];
}

// Document-level entry point (the listicle twin of blocks-to-html.ts).
export function listicleBlocksToHtml(doc: ListicleDocument | string | null | undefined): string {
  if (doc === null || doc === undefined) return "";
  let parsed: ListicleDocument | null = null;
  if (typeof doc === "string") {
    try {
      const raw = JSON.parse(doc) as unknown;
      if (isRecord(raw) && Array.isArray(raw.blocks)) {
        parsed = { blocks: raw.blocks as ListicleBlock[] };
      }
    } catch {
      parsed = null;
    }
  } else {
    parsed = doc;
  }
  if (!parsed || !Array.isArray(parsed.blocks)) return "";
  return parsed.blocks.map((block, index) => renderListicleBlock(block, index)).join("");
}

// ---------------------------------------------------------------------------
// Client editor config (embedded as JSON into the Section editor page)
// ---------------------------------------------------------------------------

export interface ListicleEditorClientConfig {
  presets: ReadonlyArray<ListicleReferencePreset>;
  textColors: Readonly<Record<string, string>>;
  highlights: Readonly<Record<string, string>>;
  emojis: ReadonlyArray<string>;
  markers: ReadonlyArray<string>;
  buttonStyles: ReadonlyArray<string>;
  buttonAligns: ReadonlyArray<string>;
}

export function listicleEditorClientConfig(): ListicleEditorClientConfig {
  return {
    presets: LISTICLE_REFERENCE_PRESETS,
    textColors: LISTICLE_TEXT_COLORS,
    highlights: LISTICLE_HIGHLIGHTS,
    emojis: LISTICLE_EMOJI_SET,
    markers: LISTICLE_LIST_MARKERS,
    buttonStyles: LISTICLE_BUTTON_STYLES,
    buttonAligns: LISTICLE_BUTTON_ALIGNS,
  };
}
