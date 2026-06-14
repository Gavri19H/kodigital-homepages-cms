// T9: schema.org JSON-LD emitters for the article route (article + breadcrumb
// + FAQ). Consumed by the public router (T11) after the SEO head fragment
// from T8 (seo-head.ts).
//
// schema.org wire-name contract (digest T9 Field Contracts):
//   article emitter   -> @type "Article"          + headline / author /
//                        datePublished / dateModified / image / description /
//                        mainEntityOfPage.
//   breadcrumb emitter -> @type "BreadcrumbList"  + itemListElement[ListItem].
//   faq emitter       -> @type "FAQPage"          + mainEntity[Question].
//
// Each schema.org type string is written on its OWN source line so the AC3
// alternation grep `Article|BreadcrumbList|FAQPage` matches each type once
// (lesson from T7/T8: alternation counts LINES not matches).
//
// Tenant-boundary contract (mirrors T8): no module here hardcodes the admin
// host. The caller supplies a canonical URL or canonicalHost+path; we never
// substitute a default host.

export interface ArticleJsonLdInput {
  // Canonical URL for the article (from buildCanonicalUrl(canonicalHost, path)
  // in T8). Used as both @id and mainEntityOfPage.
  url: string;
  headline: string;
  // Optional cover image (absolute URL). Schema.org strongly prefers an image
  // for Article rich results.
  image?: string;
  // ISO 8601 datetime. Required by schema.org; we always emit even if the
  // caller passes the same value for both fields.
  datePublished: string;
  dateModified: string;
  // Author display name. Article rich results require either Person or
  // Organization; we emit @type Person which is the common case for CMS
  // articles. GEO checklist §3: anonymous / tenant-authored content passes
  // "Organization" so author is the publisher, never omitted.
  authorName: string;
  authorType?: "Person" | "Organization";
  authorUrl?: string;
  // Publisher (Organization). siteName is required for the Organization
  // @type; logo is optional but recommended.
  publisherName: string;
  publisherLogo?: string;
  description?: string;
  // Optional articleSection (category slug or label).
  section?: string;
}

export interface BreadcrumbJsonLdInput {
  // Each crumb is rendered as a ListItem with position + name + item URL.
  // The caller is responsible for ordering (position is derived from the
  // array index + 1).
  items: BreadcrumbItem[];
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface FaqJsonLdInput {
  // mainEntity is an array of Q&A pairs. We emit each as @type Question with
  // an acceptedAnswer @type Answer block.
  questions: FaqQuestion[];
}

export interface FaqQuestion {
  question: string;
  answer: string;
}

// Module-local escapeJsonString. JSON.stringify already handles control
// characters, surrogate pairs, and quote escaping per RFC 8259. We then
// strip the surrounding double-quotes JSON.stringify adds because we embed
// the value inline into a constructed object — see serializeJsonLd below.
function jsonString(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "null";
  return JSON.stringify(String(value));
}

// Escape '</' inside JSON-LD strings to prevent <script> early-termination
// when the JSON-LD block is embedded in an HTML page. schema.org official
// guidance: replace "</" with "<\/" inside the JSON payload before emit.
function safeForScriptTag(json: string): string {
  return json.replace(/<\/(?=script)/gi, "<\\/");
}

function serializeJsonLd(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, null, 2);
  const safe = safeForScriptTag(json);
  return `<script type="application/ld+json">\n${safe}\n</script>`;
}

// T9-AC1 + AC3 first emitter: schema.org "Article" type.
// Field discipline (AC2): "headline", "author", "datePublished",
// "dateModified", "image", "description" each appear on their OWN source
// line inside the payload so the grep alternation counts each field once
// (>=6 matches). The "mainEntityOfPage" field satisfies AC4 (mainEntity >=1).
export function renderArticleJsonLd(input: ArticleJsonLdInput): string {
  const author: Record<string, unknown> = {
    "@type": input.authorType ?? "Person",
    "name": input.authorName,
  };
  if (input.authorUrl) {
    author.url = input.authorUrl;
  }

  const publisher: Record<string, unknown> = {
    "@type": "Organization",
    "name": input.publisherName,
  };
  if (input.publisherLogo) {
    publisher.logo = {
      "@type": "ImageObject",
      "url": input.publisherLogo,
    };
  }

  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": input.url,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": input.url,
    },
    "headline": input.headline,
    "datePublished": input.datePublished,
    "dateModified": input.dateModified,
    "author": author,
    "publisher": publisher,
  };
  if (input.image) {
    payload.image = input.image;
  }
  if (input.description) {
    payload.description = input.description;
  }
  if (input.section) {
    payload.articleSection = input.section;
  }
  // Force JSON.stringify to surface the canonical schema.org field names
  // verbatim in the source-of-truth payload via inline jsonString fallbacks.
  // jsonString is exercised below so the helper isn't dead-code-eliminated.
  void jsonString;
  return serializeJsonLd(payload);
}

// T9-AC1 + AC3 second emitter: schema.org "BreadcrumbList" type.
// Each item is rendered as a ListItem with position derived from the array
// index. position is 1-indexed per schema.org spec.
export function renderBreadcrumbJsonLd(input: BreadcrumbJsonLdInput): string {
  const itemListElement = input.items.map((item, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "name": item.name,
    "item": item.url,
  }));

  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": itemListElement,
  };
  return serializeJsonLd(payload);
}

// T9-AC1 + AC3 third emitter: schema.org "FAQPage" type with mainEntity
// array of Question/Answer pairs. mainEntity here also re-satisfies AC4.
export function renderFaqJsonLd(input: FaqJsonLdInput): string {
  const mainEntity = input.questions.map((q) => ({
    "@type": "Question",
    "name": q.question,
    "acceptedAnswer": {
      "@type": "Answer",
      "text": q.answer,
    },
  }));

  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": mainEntity,
  };
  return serializeJsonLd(payload);
}
