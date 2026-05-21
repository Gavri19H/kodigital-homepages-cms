// T3: Generated content types + validators. validateGeneratedArticle
// enforces >=3 h2 sections (heading.level === 2), >=3 FAQs, no placeholder
// text, and no banned legacy refs (TheIWise/insureprimo/etc).

export type GeneratedStatus =
  | "pending"
  | "success"
  | "failed"
  | "fallback"
  | "skipped_no_api_key";

export type GeneratedMeta = {
  task: string;
  model: string;
  prompt_version: string;
  status: GeneratedStatus;
  ai_generation_id?: string;
};

export type GeneratedSiteSettings = {
  meta: GeneratedMeta;
  site_id: string;
  tagline: string;
  description: string;
};
export type GeneratedAboutPageBlock = {
  type: "p" | "h2" | "ul";
  text?: string;
  items?: string[];
};
export type GeneratedAboutPage = {
  meta: GeneratedMeta;
  site_id: string;
  title: string;
  body: GeneratedAboutPageBlock[];
};
export type GeneratedStarterArticlePlanItem = {
  slug: string;
  title: string;
  summary: string;
};
export type GeneratedStarterArticlePlan = {
  meta: GeneratedMeta;
  site_id: string;
  items: GeneratedStarterArticlePlanItem[];
};
export type GeneratedArticleHeading = { level: 2 | 3; text: string };
export type GeneratedArticleFAQ = { question: string; answer: string };
export type GeneratedArticleSection = {
  heading: GeneratedArticleHeading;
  paragraphs: string[];
};
export type GeneratedArticle = {
  meta: GeneratedMeta;
  site_id: string;
  slug: string;
  title: string;
  intro: string;
  sections: GeneratedArticleSection[];
  faqs: GeneratedArticleFAQ[];
};
export type GeneratedArticleSEO = {
  meta: GeneratedMeta;
  site_id: string;
  article_slug: string;
  meta_title: string;
  meta_description: string;
  social_title?: string;
  social_description?: string;
};
export type GeneratedAltText = {
  meta: GeneratedMeta;
  site_id: string;
  media_id: string;
  alt_text: string;
};
export type GeneratedImagePrompt = {
  meta: GeneratedMeta;
  site_id: string;
  target_kind: "logo" | "feature_image";
  prompt: string;
  size: string;
  negative_prompt?: string;
};

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /lorem\s+ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bplaceholder\b/i,
];

const BANNED_LEGACY_REFS = [
  "theiwise",
  "insureprimo",
  "quotesroutes",
  "psychic-quiz",
  "rental-booking",
];

export type ValidationError = { code: string; message: string };

export class GeneratedArticleValidationError extends Error {
  errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super(
      `GeneratedArticle validation failed: ${errors.map((e) => e.code).join(",")}`,
    );
    this.name = "GeneratedArticleValidationError";
    this.errors = errors;
  }
}

function scanForBannedRefs(text: string): ValidationError | null {
  const lower = text.toLowerCase();
  for (const banned of BANNED_LEGACY_REFS) {
    if (lower.includes(banned)) {
      return {
        code: "BANNED_LEGACY_REF",
        message: `body contains banned legacy reference '${banned}'`,
      };
    }
  }
  return null;
}

function scanForPlaceholder(text: string): ValidationError | null {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) {
      return {
        code: "PLACEHOLDER_TEXT",
        message: `body contains placeholder text matching ${pattern.source}`,
      };
    }
  }
  return null;
}

export function validateGeneratedArticle(
  article: GeneratedArticle,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!article || typeof article !== "object") {
    errors.push({ code: "ARTICLE_NOT_OBJECT", message: "article is not an object" });
    return errors;
  }
  if (!article.site_id || typeof article.site_id !== "string") {
    errors.push({ code: "MISSING_SITE_ID", message: "site_id missing" });
  }
  if (!article.slug || typeof article.slug !== "string") {
    errors.push({ code: "MISSING_SLUG", message: "slug missing" });
  }
  if (!article.title || typeof article.title !== "string") {
    errors.push({ code: "MISSING_TITLE", message: "title missing" });
  }

  const sections = Array.isArray(article.sections) ? article.sections : [];
  const h2Count = sections.filter(
    (s) => s && s.heading && s.heading.level === 2,
  ).length;
  if (h2Count < 3) {
    errors.push({
      code: "TOO_FEW_H2_SECTIONS",
      message: `article requires at least 3 h2 sections; found ${h2Count}`,
    });
  }

  const faqs = Array.isArray(article.faqs) ? article.faqs : [];
  if (faqs.length < 3) {
    errors.push({
      code: "TOO_FEW_FAQS",
      message: `article requires at least 3 FAQs; found ${faqs.length}`,
    });
  }

  const fullText = [
    article.title ?? "",
    article.intro ?? "",
    ...sections.flatMap((s) => [
      s?.heading?.text ?? "",
      ...(Array.isArray(s?.paragraphs) ? s.paragraphs : []),
    ]),
    ...faqs.flatMap((f) => [f?.question ?? "", f?.answer ?? ""]),
  ].join("\n");

  const placeholder = scanForPlaceholder(fullText);
  if (placeholder) errors.push(placeholder);
  const banned = scanForBannedRefs(fullText);
  if (banned) errors.push(banned);

  return errors;
}

export function assertGeneratedArticleValid(article: GeneratedArticle): void {
  const errors = validateGeneratedArticle(article);
  if (errors.length > 0) throw new GeneratedArticleValidationError(errors);
}
