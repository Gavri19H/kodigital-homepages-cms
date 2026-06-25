// T10: schema.org JSON-LD emitters for homepage + category + page routes.
// Consumed by public router T11. Five emitters: WebSite, Organization,
// ItemList (homepage); CollectionPage (category); WebPage (page).
//
// Tenant-boundary: no module here hardcodes the admin host. Every URL
// comes from the caller. Mission-level RED LINE forbids the CMS admin
// host appearing as a canonical href / og:url / sitemap / feed URL on
// any content domain (see digest design_contract.forbidden_substitutes).
//
// SearchAction policy (T10-AC2 + design_contract.forbidden_substitutes):
// Phase 7 does NOT ship /search. SearchAction MUST be gated behind the
// searchRouteEnabled parameter — see renderHomeWebsiteJsonLd below.

export interface HomeWebsiteJsonLdInput {
  url: string;
  name: string;
  // Search URL template (e.g. "https://x.com/search?q={search_term_string}").
  // Only emitted when searchRouteEnabled is true.
  searchUrlTemplate?: string;
  // GATE for potentialAction SearchAction emission.
  searchRouteEnabled?: boolean;
}

export interface HomeOrganizationJsonLdInput {
  url: string;
  name: string;
  logoUrl?: string;
  sameAs?: string[];
}

export interface HomeItemListJsonLdInput {
  items: HomeItemListEntry[];
  listName?: string;
}

export interface HomeItemListEntry {
  name: string;
  url: string;
}

export interface CategoryJsonLdInput {
  url: string;
  name: string;
  description?: string;
  articles: HomeItemListEntry[];
}

export interface WebPageJsonLdInput {
  url: string;
  name: string;
  description?: string;
  datePublished?: string;
  dateModified?: string;
  inLanguage?: string;
}

function jsonString(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "null";
  return JSON.stringify(String(value));
}

// schema.org official guidance: replace "</" with "<\/" before "script"
// inside the JSON payload so a tenant-supplied string can't break out of
// the surrounding <script type="application/ld+json"> wrapper.
function safeForScriptTag(json: string): string {
  return json.replace(/<\/(?=script)/gi, "<\\/");
}

function serializeJsonLd(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload, null, 2);
  const safe = safeForScriptTag(json);
  return `<script type="application/ld+json">\n${safe}\n</script>`;
}

// T10-AC1 first emitter: schema.org "WebSite" type.
// T10-AC2: potentialAction SearchAction is GATED behind searchRouteEnabled.
// When the flag is false (default), the payload omits potentialAction
// entirely so we never advertise a /search endpoint we don't ship.
export function renderHomeWebsiteJsonLd(input: HomeWebsiteJsonLdInput): string {
  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": input.url,
    "url": input.url,
    "name": input.name,
  };
  // SearchAction gate. Both the flag AND a non-empty template must be
  // present; either alone is insufficient. This is the T10-AC2 RED LINE.
  if (input.searchRouteEnabled === true && input.searchUrlTemplate) {
    payload.potentialAction = {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": input.searchUrlTemplate,
      },
      "query-input": "required name=search_term_string",
    };
  }
  void jsonString;
  return serializeJsonLd(payload);
}

// T10-AC1 second emitter: schema.org "Organization" type.
export function renderHomeOrganizationJsonLd(
  input: HomeOrganizationJsonLdInput,
): string {
  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": input.url,
    "url": input.url,
    "name": input.name,
  };
  if (input.logoUrl) {
    payload.logo = {
      "@type": "ImageObject",
      "url": input.logoUrl,
    };
  }
  if (input.sameAs && input.sameAs.length > 0) {
    payload.sameAs = input.sameAs;
  }
  return serializeJsonLd(payload);
}

// T10-AC1 third emitter: schema.org "ItemList" type (homepage list).
export function renderHomeItemListJsonLd(
  input: HomeItemListJsonLdInput,
): string {
  const itemListElement = input.items.map((item, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "name": item.name,
    "url": item.url,
  }));

  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": itemListElement,
  };
  if (input.listName) {
    payload.name = input.listName;
  }
  return serializeJsonLd(payload);
}

// T10-AC1 fourth emitter: schema.org "CollectionPage" for category routes.
// mainEntity wraps the article list as an ItemList — single render covers
// both the page-level "what is this" and the list-level "what's on it".
export function renderCategoryJsonLd(input: CategoryJsonLdInput): string {
  const articleList = input.articles.map((item, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "name": item.name,
    "url": item.url,
  }));

  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": input.url,
    "url": input.url,
    "name": input.name,
    "mainEntity": {
      "@type": "ItemList",
      "itemListElement": articleList,
    },
  };
  if (input.description) {
    payload.description = input.description;
  }
  return serializeJsonLd(payload);
}

// T10-AC1 fifth emitter: schema.org "WebPage" for generic page routes
// (about, contact, terms, etc.).
export function renderWebPageJsonLd(input: WebPageJsonLdInput): string {
  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": input.url,
    "url": input.url,
    "name": input.name,
  };
  if (input.description) {
    payload.description = input.description;
  }
  if (input.datePublished) {
    payload.datePublished = input.datePublished;
  }
  if (input.dateModified) {
    payload.dateModified = input.dateModified;
  }
  if (input.inLanguage) {
    payload.inLanguage = input.inLanguage;
  }
  return serializeJsonLd(payload);
}

// rescue-6 (agent-readiness M6): parse an operator newline/comma list of
// OFFICIAL profile URLs into a clean sameAs[] for the Organization node. Only
// absolute http(s) URLs are kept — a broken/relative sameAs is worse than none
// (it weakens entity recognition), so anything else is silently dropped.
export function parseSameAsList(raw: string | undefined | null): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const url = part.trim();
    if (/^https?:\/\/\S+$/i.test(url) && !out.includes(url)) out.push(url);
  }
  return out;
}
