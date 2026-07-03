// Server-side validators for the Listicles admin API (design contract §23).
// Every validator returns FIELD-KEYED errors — the API failure envelope is
// { error, fields } (§7.1) and these maps plug straight into `fields`.
//
// Validators are pure (no DB access). Referential checks that need the
// database — "offer exists & active", "section exists", slug uniqueness,
// experiment partial-unique — live in the handlers, which merge their
// findings into the same field-keyed map.

import {
  isListicleBlockType,
  LISTICLE_BUTTON_ALIGNS,
  LISTICLE_BUTTON_STYLES,
  LISTICLE_EMOJI_SET,
  LISTICLE_HIGHLIGHTS,
  LISTICLE_LIST_MARKERS,
  LISTICLE_TEXT_COLORS,
} from "../editor/listicle-blocks";
import { validateOfferUrlTemplate } from "./macros";
import { parseConditions, type RuleConditions } from "./rules";

export type FieldErrors = Record<string, string>;

export const TRACKING_METHODS = ["s2s_postback", "browser_side_pixel", "script"] as const;
export type TrackingMethod = (typeof TRACKING_METHODS)[number];

export const PAYOUT_METHODS = ["in_site", "offsite"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const OFFER_STATUSES = ["active", "paused", "archived"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const CAP_COUNT_BY = ["clicks", "conversions"] as const;
export type CapCountBy = (typeof CAP_COUNT_BY)[number];

export const SECTION_STATUSES = ["active", "archived"] as const;
export const ARTICLE_STATUSES = ["draft", "published", "scheduled", "archived"] as const;
export const SELECTION_MODES = ["single", "ab_test", "rule_based"] as const;
export type SelectionMode = (typeof SELECTION_MODES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asFlag(value: unknown): 0 | 1 {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

// ---------------------------------------------------------------------------
// Offer (§23 "Offer")
// ---------------------------------------------------------------------------

export interface OfferInput {
  offer_name: string;
  provider: string;
  activity: string;
  vertical: string;
  tag: string | null;
  conversion_tracking_method: TrackingMethod;
  offer_url_template: string; // alias-normalized ({clickid} → {click_id})
  payout_method: PayoutMethod;
  payout_currency: string | null;
  payout_value: number | null;
  cap_enabled: 0 | 1;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: CapCountBy | null;
  cap_fallback_offer_id: number | null;
  cap_fallback_url: string | null;
  status: OfferStatus;
}

export interface OfferValidation {
  errors: FieldErrors;
  value: OfferInput | null;
}

export function validateOffer(raw: Record<string, unknown>): OfferValidation {
  const errors: FieldErrors = {};

  const offer_name = trimmedString(raw.offer_name);
  if (offer_name === null) errors.offer_name = "offer_name is required";
  const provider = trimmedString(raw.provider);
  if (provider === null) errors.provider = "provider is required";
  const activity = trimmedString(raw.activity);
  if (activity === null) errors.activity = "activity is required";
  const vertical = trimmedString(raw.vertical);
  if (vertical === null) errors.vertical = "vertical is required";
  const tag = optionalString(raw.tag);

  const conversion_tracking_method = oneOf(raw.conversion_tracking_method, TRACKING_METHODS);
  if (conversion_tracking_method === null) {
    errors.conversion_tracking_method =
      "conversion_tracking_method must be one of s2s_postback, browser_side_pixel, script";
  }

  let offer_url_template = "";
  if (typeof raw.offer_url_template !== "string" || raw.offer_url_template.trim() === "") {
    errors.offer_url_template = "offer_url_template is required";
  } else {
    const verdict = validateOfferUrlTemplate(raw.offer_url_template);
    if (!verdict.ok) {
      errors.offer_url_template = verdict.errors.join("; ");
    }
    offer_url_template = verdict.normalized;
  }

  const payout_method = oneOf(raw.payout_method, PAYOUT_METHODS);
  if (payout_method === null) {
    errors.payout_method = "payout_method must be in_site or offsite";
  }

  // Conditional set (§23): in_site ⇒ payout_currency + payout_value.
  let payout_currency = optionalString(raw.payout_currency);
  let payout_value = finiteNumber(raw.payout_value);
  if (payout_method === "in_site") {
    if (payout_currency === null) {
      errors.payout_currency = "payout_currency is required when payout_method is in_site";
    }
    if (payout_value === null || payout_value < 0) {
      errors.payout_value = "payout_value is required (a number >= 0) when payout_method is in_site";
      payout_value = null;
    }
  } else if (payout_method === "offsite") {
    payout_currency = payout_currency ?? null;
    payout_value = payout_value !== null && payout_value >= 0 ? payout_value : null;
  }

  // Conditional set (§23): cap_enabled ⇒ cap_amount + cap_timezone + cap_count_by.
  const cap_enabled = asFlag(raw.cap_enabled);
  let cap_amount: number | null = null;
  let cap_timezone: string | null = null;
  let cap_count_by: CapCountBy | null = null;
  if (cap_enabled === 1) {
    cap_amount = positiveInt(raw.cap_amount);
    if (cap_amount === null) {
      errors.cap_amount = "cap_amount is required (a positive integer) when the cap is enabled";
    }
    cap_timezone = trimmedString(raw.cap_timezone);
    if (cap_timezone === null) {
      errors.cap_timezone = "cap_timezone is required when the cap is enabled";
    }
    cap_count_by = oneOf(raw.cap_count_by, CAP_COUNT_BY);
    if (cap_count_by === null) {
      errors.cap_count_by = "cap_count_by must be clicks or conversions when the cap is enabled";
    }
  }

  // Optional fallback targets (valid with or without the cap toggle; only
  // meaningful when capped).
  let cap_fallback_offer_id: number | null = null;
  if (raw.cap_fallback_offer_id !== undefined && raw.cap_fallback_offer_id !== null) {
    cap_fallback_offer_id = positiveInt(raw.cap_fallback_offer_id);
    if (cap_fallback_offer_id === null) {
      errors.cap_fallback_offer_id = "cap_fallback_offer_id must be a positive integer";
    }
  }
  let cap_fallback_url: string | null = null;
  if (raw.cap_fallback_url !== undefined && raw.cap_fallback_url !== null) {
    const url = optionalString(raw.cap_fallback_url);
    if (url === null || !/^(https?:\/\/|\/)/i.test(url)) {
      errors.cap_fallback_url = "cap_fallback_url must be an absolute http(s) URL or a site-relative path";
    } else {
      cap_fallback_url = url;
    }
  }

  const status = raw.status === undefined ? "active" : oneOf(raw.status, OFFER_STATUSES);
  if (status === null) {
    errors.status = "status must be one of active, paused, archived";
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      offer_name: offer_name as string,
      provider: provider as string,
      activity: activity as string,
      vertical: vertical as string,
      tag,
      conversion_tracking_method: conversion_tracking_method as TrackingMethod,
      offer_url_template,
      payout_method: payout_method as PayoutMethod,
      payout_currency,
      payout_value,
      cap_enabled,
      cap_amount,
      cap_timezone,
      cap_count_by,
      cap_fallback_offer_id,
      cap_fallback_url,
      status: status as OfferStatus,
    },
  };
}

// ---------------------------------------------------------------------------
// Section (§23 "Section" + the governed-link invariant §12/§13)
// ---------------------------------------------------------------------------

export interface SectionBlock {
  type: string;
  data: Record<string, unknown>;
  // Optional editor-assigned block id (PR4 block model); falls back to the
  // positional id downstream.
  id?: string;
}

export interface SectionInput {
  section_name: string;
  headline_text: string;
  headline_offer_id: number | null;
  image_json: string | null;
  content_json: string; // canonical serialized document
  ai_settings_json: string | null;
  status: (typeof SECTION_STATUSES)[number];
  blocks: SectionBlock[];
}

const IMAGE_TYPES = ["image", "gif", "ai_generated"] as const;

// Block types whose block-level link MUST be offer-bound — this gate is what
// enforces `final_text_cta`'s offer requirement (its shape check below only
// adds the text rule). `affiliate` is the legacy free-text-URL card —
// forbidden outright in listicle sections. (`choice_button` items live INSIDE
// choice_button_group and are checked per-item; a bare 'choice_button'/'cta'
// block type is rejected by the vocabulary gate before this set is consulted.)
const OFFER_BOUND_BLOCK_TYPES = new Set(["button", "final_text_cta"]);

const ANCHOR_WITH_HREF_RE = /<a\b[^>]*\bhref\s*=/i;
// An anchor that does NOT carry a data-offer reference (§12/§13: the Offer
// modal is the ONLY link mechanism — an ungoverned anchor blocks the save).
const ANCHOR_WITHOUT_OFFER_RE = /<a\b(?![^>]*\bdata-offer\s*=)[^>]*>/i;
// Curated colour tokens (§12): every data-lst-color / data-lst-highlight
// value in inline HTML must come from the curated palette.
const LST_COLOR_ATTR_RE = /data-lst-(color|highlight)\s*=\s*["']([^"']*)["']/gi;

// Recursively scan every string in a block's data for raw anchor markup.
// Listicle content links are governed: they carry `data-offer` (an Offer
// reference), never an author-supplied href (§12 "Links store the Offer,
// not the URL").
function containsRawHref(value: unknown): boolean {
  if (typeof value === "string") return ANCHOR_WITH_HREF_RE.test(value);
  if (Array.isArray(value)) return value.some((v) => containsRawHref(v));
  if (isRecord(value)) return Object.values(value).some((v) => containsRawHref(v));
  return false;
}

function containsUngovernedAnchor(value: unknown): boolean {
  if (typeof value === "string") return ANCHOR_WITHOUT_OFFER_RE.test(value);
  if (Array.isArray(value)) return value.some((v) => containsUngovernedAnchor(v));
  if (isRecord(value)) return Object.values(value).some((v) => containsUngovernedAnchor(v));
  return false;
}

function collectUnknownColorTokens(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(LST_COLOR_ATTR_RE)) {
      const kind = (match[1] ?? "").toLowerCase();
      const token = match[2] ?? "";
      const known =
        kind === "color"
          ? LISTICLE_TEXT_COLORS[token] !== undefined
          : LISTICLE_HIGHLIGHTS[token] !== undefined;
      if (!known) out.add(`${kind}:${token}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUnknownColorTokens(v, out);
    return;
  }
  if (isRecord(value)) {
    for (const v of Object.values(value)) collectUnknownColorTokens(v, out);
  }
}

// An offer reference field: the legacy internal integer id (Phase-2 API) or
// the off_… public id string (§30.5 shapes). Existence/active checks against
// the DB stay in the handler.
function hasOfferRef(value: unknown): boolean {
  if (positiveInt(value) !== null) return true;
  return typeof value === "string" && value.trim() !== "";
}

// Exported for the §30.6 preview endpoint: lenient STRUCTURAL parse of a
// content_json document (previews render mid-edit content; only malformed
// JSON is rejected — full §23 validation stays the save gate).
export function parseSectionBlocks(
  raw: unknown,
): { blocks: SectionBlock[]; json: string } | string {
  return parseBlocks(raw);
}

function parseBlocks(raw: unknown): { blocks: SectionBlock[]; json: string } | string {
  let doc: unknown = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw) as unknown;
    } catch {
      return "content_json is not valid JSON";
    }
  }
  if (!isRecord(doc) || !Array.isArray(doc.blocks)) {
    return "content_json must be a { blocks: [...] } document";
  }
  const blocks: SectionBlock[] = [];
  for (const rawBlock of doc.blocks) {
    if (!isRecord(rawBlock) || typeof rawBlock.type !== "string") {
      return "every content block must be an object with a string `type`";
    }
    const data = isRecord(rawBlock.data) ? rawBlock.data : {};
    const block: SectionBlock = { type: rawBlock.type, data };
    if (typeof rawBlock.id === "string" && rawBlock.id.trim() !== "") {
      block.id = rawBlock.id;
    }
    blocks.push(block);
  }
  return { blocks, json: JSON.stringify({ version: 1, blocks }) };
}

// §30.5/§12 per-type shape checks (returns an error message or null).
// Offer EXISTENCE/ACTIVE checks stay in the handler; this validates shapes.
function validateListicleBlockShape(block: SectionBlock): string | null {
  const data = block.data;
  switch (block.type) {
    case "button": {
      if (trimmedString(data.text) === null) {
        return "a 'button' block needs its button text";
      }
      const style = data.style;
      if (
        style !== undefined &&
        style !== null &&
        !(LISTICLE_BUTTON_STYLES as readonly string[]).includes(asStringOr(style))
      ) {
        return `button style must be one of ${LISTICLE_BUTTON_STYLES.join(", ")}`;
      }
      const align = data.align;
      if (
        align !== undefined &&
        align !== null &&
        !(LISTICLE_BUTTON_ALIGNS as readonly string[]).includes(asStringOr(align))
      ) {
        return `button align must be one of ${LISTICLE_BUTTON_ALIGNS.join(", ")}`;
      }
      return null;
    }
    case "choice_button_group": {
      const items = data.items;
      if (!Array.isArray(items) || items.length === 0) {
        return "a choice button group needs at least one button";
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isRecord(item)) {
          return `choice button ${i + 1} must be an object`;
        }
        if (trimmedString(item.text) === null) {
          return `choice button ${i + 1} needs its button text`;
        }
        if (!hasOfferRef(item.offer_id)) {
          return `choice button ${i + 1} must reference an Offer (offer_id) — a button without an Offer blocks the save`;
        }
        if (typeof item.url === "string" || typeof item.href === "string") {
          return "free-text URLs are forbidden in listicle Sections — the link target is derived from the Offer";
        }
        const styleId = item.style_id;
        if (
          styleId !== undefined &&
          styleId !== null &&
          asStringOr(styleId) !== "reference-choice-button"
        ) {
          return `choice button ${i + 1} style_id must be "reference-choice-button" (§30.5)`;
        }
      }
      return null;
    }
    case "final_text_cta": {
      if (trimmedString(data.text) === null) {
        return "a final text CTA needs its link text";
      }
      return null;
    }
    case "linked_image": {
      if (!hasOfferRef(data.offer_id)) {
        return "a linked image must reference an Offer (offer_id) — an image link without an Offer blocks the save";
      }
      if (trimmedString(data.alt) === null) {
        return "a linked image needs alt text (§30.5 LinkedImage.alt)";
      }
      const hasMedia = positiveInt(data.media_id) !== null;
      const hasUrl =
        trimmedString(data.image_url) !== null || trimmedString(data.url) !== null;
      if (!hasMedia && !hasUrl) {
        return "a linked image needs an image (media_id or image_url)";
      }
      return null;
    }
    case "list": {
      const marker = data.marker;
      if (marker !== undefined && marker !== null) {
        const m = asStringOr(marker);
        if (!(LISTICLE_LIST_MARKERS as readonly string[]).includes(m)) {
          return `list marker must be one of ${LISTICLE_LIST_MARKERS.join(", ")}`;
        }
        if (m === "emoji") {
          const emoji = trimmedString(data.emoji);
          if (emoji === null) {
            return "an emoji list needs its marker emoji";
          }
          if (!LISTICLE_EMOJI_SET.includes(emoji)) {
            return "the emoji list marker must come from the curated emoji set";
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function asStringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export interface SectionValidation {
  errors: FieldErrors;
  value: SectionInput | null;
}

export function validateSection(raw: Record<string, unknown>): SectionValidation {
  const errors: FieldErrors = {};

  const section_name = trimmedString(raw.section_name);
  if (section_name === null) errors.section_name = "section_name is required";
  const headline_text = trimmedString(raw.headline_text);
  if (headline_text === null) errors.headline_text = "headline_text is required";

  let headline_offer_id: number | null = null;
  if (raw.headline_offer_id !== undefined && raw.headline_offer_id !== null) {
    headline_offer_id = positiveInt(raw.headline_offer_id);
    if (headline_offer_id === null) {
      errors.headline_offer_id = "headline_offer_id must be a positive integer (an Offer id)";
    }
  }

  // image is optional; when present it must be the §5.2 shape.
  let image_json: string | null = null;
  const imageRaw = raw.image_json ?? raw.image;
  if (imageRaw !== undefined && imageRaw !== null) {
    let image: unknown = imageRaw;
    if (typeof imageRaw === "string") {
      try {
        image = JSON.parse(imageRaw) as unknown;
      } catch {
        errors.image = "image must be valid JSON";
        image = null;
      }
    }
    if (image !== null) {
      if (!isRecord(image) || oneOf(image.type, IMAGE_TYPES) === null) {
        errors.image = "image.type must be one of image, gif, ai_generated";
      } else {
        image_json = JSON.stringify(image);
      }
    }
  }

  let ai_settings_json: string | null = null;
  const aiRaw = raw.ai_settings_json ?? raw.ai_settings;
  if (aiRaw !== undefined && aiRaw !== null) {
    if (typeof aiRaw === "string") {
      try {
        JSON.parse(aiRaw);
        ai_settings_json = aiRaw;
      } catch {
        errors.ai_settings = "ai_settings must be valid JSON";
      }
    } else if (isRecord(aiRaw)) {
      ai_settings_json = JSON.stringify(aiRaw);
    } else {
      errors.ai_settings = "ai_settings must be an object";
    }
  }

  const status =
    raw.status === undefined ? "active" : oneOf(raw.status, SECTION_STATUSES);
  if (status === null) errors.status = "status must be active or archived";

  // §23: ≥1 content block, and every link governed (no free-text URL).
  let blocks: SectionBlock[] = [];
  let content_json = "";
  if (raw.content_json === undefined || raw.content_json === null) {
    errors.content_json = "content_json is required";
  } else {
    const parsed = parseBlocks(raw.content_json);
    if (typeof parsed === "string") {
      errors.content_json = parsed;
    } else {
      blocks = parsed.blocks;
      content_json = parsed.json;
      if (blocks.length === 0) {
        errors.content_json = "a Section needs at least one content block";
      }
      blocks.forEach((block, index) => {
        const key = `content.blocks[${index}]`;
        if (block.type === "affiliate") {
          errors[key] =
            "the legacy 'affiliate' block is forbidden in listicle Sections — links must reference an Offer";
          return;
        }
        if (!isListicleBlockType(block.type)) {
          errors[key] =
            `'${block.type}' is not a listicle content block — the listicle grammar (§12) allows: text, headings, lists, quotes, images, buttons, choice button groups, final text CTAs, linked images, and spacers`;
          return;
        }
        if (containsRawHref(block.data)) {
          errors[key] =
            "free-text URLs are forbidden in listicle Sections — convert the link to an Offer reference";
          return;
        }
        if (containsUngovernedAnchor(block.data)) {
          errors[key] =
            "every link must reference an Offer — insert links through the Offer modal (an <a> without data-offer blocks the save)";
          return;
        }
        const unknownColors = new Set<string>();
        collectUnknownColorTokens(block.data, unknownColors);
        if (unknownColors.size > 0) {
          errors[key] =
            `unknown colour token(s) ${[...unknownColors].join(", ")} — text colours and highlights come from the curated palette`;
          return;
        }
        if (OFFER_BOUND_BLOCK_TYPES.has(block.type)) {
          if (!hasOfferRef(block.data.offer_id)) {
            errors[key] = `a '${block.type}' block must reference an Offer (offer_id)`;
            return;
          }
          if (typeof block.data.url === "string" || typeof block.data.href === "string") {
            errors[key] =
              "free-text URLs are forbidden in listicle Sections — the link target is derived from the Offer";
            return;
          }
        }
        const blockError = validateListicleBlockShape(block);
        if (blockError !== null) {
          errors[key] = blockError;
        }
      });
    }
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      section_name: section_name as string,
      headline_text: headline_text as string,
      headline_offer_id,
      image_json,
      content_json,
      ai_settings_json,
      status: status as (typeof SECTION_STATUSES)[number],
      blocks,
    },
  };
}

// ---------------------------------------------------------------------------
// Article base (§23 "Article & Version")
// ---------------------------------------------------------------------------

export interface ArticleInput {
  site_id: string;
  article_name: string;
  slug: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateArticle(raw: Record<string, unknown>): {
  errors: FieldErrors;
  value: ArticleInput | null;
} {
  const errors: FieldErrors = {};
  const site_id = trimmedString(raw.site_id);
  if (site_id === null) errors.site_id = "site_id is required";
  const article_name = trimmedString(raw.article_name);
  if (article_name === null) errors.article_name = "article_name is required";
  const slug = trimmedString(raw.slug);
  if (slug === null) {
    errors.slug = "slug is required";
  } else if (!SLUG_RE.test(slug)) {
    errors.slug = "slug must be lowercase letters/digits with single hyphens (e.g. best-cat-food)";
  }
  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      site_id: site_id as string,
      article_name: article_name as string,
      slug: slug as string,
    },
  };
}

// ---------------------------------------------------------------------------
// Version + Pages (§23 "Article & Version" + "Experimentation")
// ---------------------------------------------------------------------------

export interface RulePayload {
  public_id: string | null;
  priority: number;
  conditions: RuleConditions;
}

export interface CandidatePayload {
  public_id: string | null;
  section_id: number;
  label: string;
  traffic_allocation: number | null;
  is_fallback: boolean;
  rule: RulePayload | null;
}

export interface PagePayload {
  public_id: string | null;
  page_index: number;
  selection_mode: SelectionMode;
  ab_test_id: string | null;
  rule_set_id: string | null;
  candidates: CandidatePayload[];
}

export interface VersionFieldsInput {
  headline: string;
  intro_paragraph: string;
  hero_media_id: number | null;
  hero_media_url: string | null;
  layout_style_id: string;
  ai_settings_json: string | null;
}

// Version-level required fields (§23): headline, intro_paragraph, hero image
// (media id OR url), layout_style. Pages are validated separately so the
// create-article path (control Version starts with no pages — §5.3 builds
// them later via PUT /versions/:id) can reuse this.
export function validateVersionFields(raw: Record<string, unknown>): {
  errors: FieldErrors;
  value: VersionFieldsInput | null;
} {
  const errors: FieldErrors = {};
  const headline = trimmedString(raw.headline);
  if (headline === null) errors.headline = "headline is required";
  const intro_paragraph = trimmedString(raw.intro_paragraph);
  if (intro_paragraph === null) errors.intro_paragraph = "intro_paragraph is required";

  let hero_media_id: number | null = null;
  if (raw.hero_media_id !== undefined && raw.hero_media_id !== null) {
    hero_media_id = positiveInt(raw.hero_media_id);
    if (hero_media_id === null) errors.hero_media_id = "hero_media_id must be a positive integer";
  }
  const hero_media_url = optionalString(raw.hero_media_url);
  if (hero_media_id === null && hero_media_url === null && errors.hero_media_id === undefined) {
    errors.hero = "a hero image is required (hero_media_id or hero_media_url)";
  }

  const layout_style_id = trimmedString(raw.layout_style_id);
  if (layout_style_id === null) errors.layout_style_id = "layout_style_id is required";

  let ai_settings_json: string | null = null;
  const aiRaw = raw.ai_settings_json ?? raw.ai_settings;
  if (aiRaw !== undefined && aiRaw !== null) {
    if (typeof aiRaw === "string") {
      try {
        JSON.parse(aiRaw);
        ai_settings_json = aiRaw;
      } catch {
        errors.ai_settings = "ai_settings must be valid JSON";
      }
    } else if (isRecord(aiRaw)) {
      ai_settings_json = JSON.stringify(aiRaw);
    } else {
      errors.ai_settings = "ai_settings must be an object";
    }
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      headline: headline as string,
      intro_paragraph: intro_paragraph as string,
      hero_media_id,
      hero_media_url,
      layout_style_id: layout_style_id as string,
      ai_settings_json,
    },
  };
}

function allocationInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100) {
    return value;
  }
  return null;
}

// Parse + validate ONE page payload. Error keys use the contract's
// `page_<idx>.<field>` convention (§15.5 uses `page_<idx>.rules`).
export function validatePage(
  raw: unknown,
  pageIndex: number,
): { errors: FieldErrors; value: PagePayload | null } {
  const errors: FieldErrors = {};
  const key = (field: string): string => `page_${pageIndex}.${field}`;

  if (!isRecord(raw)) {
    errors[key("page")] = "each page must be an object";
    return { errors, value: null };
  }

  const selection_mode = oneOf(raw.selection_mode ?? "single", SELECTION_MODES);
  if (selection_mode === null) {
    errors[key("selection_mode")] = "selection_mode must be single, ab_test, or rule_based";
    return { errors, value: null };
  }

  const candidatesRaw = raw.candidates;
  if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) {
    errors[key("candidates")] = "each page needs at least one Section candidate";
    return { errors, value: null };
  }

  const candidates: CandidatePayload[] = [];
  candidatesRaw.forEach((rawCand, candIndex) => {
    const candKey = (field: string): string => key(`candidates[${candIndex}].${field}`);
    if (!isRecord(rawCand)) {
      errors[candKey("candidate")] = "candidate must be an object";
      return;
    }
    const section_id = positiveInt(rawCand.section_id);
    if (section_id === null) {
      errors[candKey("section_id")] = "candidate must reference a valid section_id";
      return;
    }
    const label =
      trimmedString(rawCand.label) ?? String.fromCharCode(65 + (candIndex % 26));
    const is_fallback = rawCand.is_fallback === true || rawCand.is_fallback === 1;

    let traffic_allocation: number | null = null;
    if (selection_mode === "ab_test") {
      traffic_allocation = allocationInt(rawCand.traffic_allocation);
      if (traffic_allocation === null) {
        errors[candKey("traffic_allocation")] =
          "each ab_test candidate needs an integer traffic_allocation (0-100)";
      }
    }

    let rule: RulePayload | null = null;
    if (selection_mode === "rule_based" && !is_fallback) {
      const rawRule = rawCand.rule;
      if (!isRecord(rawRule)) {
        errors[candKey("rule")] = "each non-fallback rule_based candidate needs a rule";
      } else {
        const priority = rawRule.priority;
        if (typeof priority !== "number" || !Number.isInteger(priority)) {
          errors[candKey("rule.priority")] = "rule.priority must be an integer";
        }
        const parsed = parseConditions(rawRule.conditions ?? rawRule.conditions_json);
        if (!parsed.ok) {
          errors[candKey("rule.conditions")] = parsed.error;
        } else if (typeof priority === "number" && Number.isInteger(priority)) {
          rule = {
            public_id:
              typeof rawRule.public_id === "string" && rawRule.public_id.trim() !== ""
                ? rawRule.public_id.trim()
                : null,
            priority,
            conditions: parsed.conditions,
          };
        }
      }
    }

    candidates.push({
      public_id:
        typeof rawCand.public_id === "string" && rawCand.public_id.trim() !== ""
          ? rawCand.public_id.trim()
          : null,
      section_id,
      label,
      traffic_allocation,
      is_fallback,
      rule,
    });
  });

  // Mode-specific invariants (§23 / §15.8).
  if (selection_mode === "single" && candidatesRaw.length !== 1) {
    errors[key("candidates")] = "a 'single' page carries exactly one Section candidate";
  }
  if (selection_mode === "ab_test") {
    const sum = candidates.reduce((acc, cand) => acc + (cand.traffic_allocation ?? 0), 0);
    if (candidates.length === candidatesRaw.length && sum !== 100) {
      errors[key("traffic_allocation")] =
        `ab_test candidate allocations must total 100 (got ${sum})`;
    }
  }
  if (selection_mode === "rule_based") {
    const fallbacks = candidates.filter((cand) => cand.is_fallback).length;
    if (fallbacks !== 1) {
      errors[key("fallback")] =
        `a rule_based page needs exactly one fallback candidate (got ${fallbacks})`;
    }
  }

  const page_index =
    typeof raw.page_index === "number" && Number.isInteger(raw.page_index) && raw.page_index >= 0
      ? raw.page_index
      : pageIndex;

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      public_id:
        typeof raw.public_id === "string" && raw.public_id.trim() !== ""
          ? raw.public_id.trim()
          : null,
      page_index,
      selection_mode,
      ab_test_id: optionalString(raw.ab_test_id),
      rule_set_id: optionalString(raw.rule_set_id),
      candidates,
    },
  };
}

export interface VersionValidation {
  errors: FieldErrors;
  fields: VersionFieldsInput | null;
  pages: PagePayload[];
}

// Full Version validation (§23): version fields + ≥1 Page, each Page ≥1
// candidate + its mode invariants. The rule-CONFLICT guard (needs Section
// names from the DB for the §15.5 payload) runs in the handler on top of
// this.
export function validateVersion(raw: Record<string, unknown>): VersionValidation {
  const fieldsResult = validateVersionFields(raw);
  const errors: FieldErrors = { ...fieldsResult.errors };

  const pages: PagePayload[] = [];
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    errors.pages = "a Version needs at least one Page";
  } else {
    raw.pages.forEach((rawPage, index) => {
      const result = validatePage(rawPage, index);
      Object.assign(errors, result.errors);
      if (result.value !== null) pages.push(result.value);
    });
    // Page indexes must be unique (they define order within the Version).
    const seen = new Set<number>();
    for (const page of pages) {
      if (seen.has(page.page_index)) {
        errors.pages = `duplicate page_index ${page.page_index}`;
        break;
      }
      seen.add(page.page_index);
    }
  }

  return { errors, fields: fieldsResult.value, pages };
}

// ---------------------------------------------------------------------------
// Experiment (§23 "Experimentation" — Article A/B)
// ---------------------------------------------------------------------------

export interface ExperimentVersionEntry {
  version_id: number | string | null; // internal id or ver_ public id
  new_version: Record<string, unknown> | null;
  variant_label: string | null;
  traffic_allocation: number;
  is_control: boolean;
}

export interface ExperimentInput {
  name: string;
  versions: ExperimentVersionEntry[];
}

export function validateExperiment(raw: Record<string, unknown>): {
  errors: FieldErrors;
  value: ExperimentInput | null;
} {
  const errors: FieldErrors = {};
  const name = trimmedString(raw.name);
  if (name === null) errors.name = "name is required";

  const versionsRaw = raw.versions;
  const entries: ExperimentVersionEntry[] = [];
  if (!Array.isArray(versionsRaw) || versionsRaw.length === 0) {
    errors.versions = "versions must be a non-empty array";
  } else {
    versionsRaw.forEach((rawEntry, index) => {
      const key = (field: string): string => `versions[${index}].${field}`;
      if (!isRecord(rawEntry)) {
        errors[key("entry")] = "each version entry must be an object";
        return;
      }
      const traffic_allocation = allocationInt(rawEntry.traffic_allocation);
      if (traffic_allocation === null) {
        errors[key("traffic_allocation")] =
          "traffic_allocation must be an integer 0-100";
      }
      const is_control = rawEntry.is_control === true || rawEntry.is_control === 1;

      let version_id: number | string | null = null;
      if (typeof rawEntry.version_id === "number") {
        version_id = positiveInt(rawEntry.version_id);
        if (version_id === null) errors[key("version_id")] = "version_id must be a positive integer";
      } else if (typeof rawEntry.version_id === "string" && rawEntry.version_id.trim() !== "") {
        version_id = rawEntry.version_id.trim();
      }

      let new_version: Record<string, unknown> | null = null;
      if (version_id === null) {
        // New arm: must carry the §23 Version required fields.
        const fieldsResult = validateVersionFields(rawEntry);
        if (fieldsResult.value === null) {
          for (const [field, message] of Object.entries(fieldsResult.errors)) {
            errors[key(field)] = message;
          }
        } else {
          new_version = rawEntry;
        }
      }

      if (traffic_allocation !== null) {
        entries.push({
          version_id,
          new_version,
          variant_label: optionalString(rawEntry.variant_label),
          traffic_allocation,
          is_control,
        });
      }
    });

    if (entries.length === versionsRaw.length) {
      const sum = entries.reduce((acc, entry) => acc + entry.traffic_allocation, 0);
      if (sum !== 100) {
        errors.traffic_allocation = `version allocations must total 100 (got ${sum})`;
      }
      const controls = entries.filter((entry) => entry.is_control).length;
      if (controls !== 1) {
        errors.is_control = `exactly one control version is required (got ${controls})`;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return { errors, value: { name: name as string, versions: entries } };
}
