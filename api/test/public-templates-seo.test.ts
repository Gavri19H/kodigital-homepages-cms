// Phase 5 / T6 BEHAVIORAL guard for templates/seo.ts.
// AC: GIVEN faqs=[] WHEN buildFaqJsonLd THEN empty string.
// PART 6 spec: an Article without FAQ blocks must NOT emit a FAQPage
// JSON-LD payload — Google's rich-results validator rejects an empty
// mainEntity array. The "" return lets the layout skip the
// <script type="application/ld+json"> emission entirely (see T3
// renderJsonLdBlocks).

import { describe, it, expect } from "vitest";
import {
  buildHomeJsonLd,
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildMetaTags,
  type SeoSite,
  type SeoArticle,
} from "../src/public/templates/seo";

const SITE: SeoSite = {
  name: "Demo Site",
  hostname: "demo.example",
  origin: "https://demo.example",
  tagline: "A vertical-agnostic tagline",
  description: "A long-form site description used for og:description fallback.",
  logoUrl: "https://cdn.example/logo.png",
};

describe("public-templates-seo", () => {
  it("T6.AC3: faq_empty: buildFaqJsonLd returns empty string when faqs is []", () => {
    const out = buildFaqJsonLd({ faqs: [] });
    expect(out).toBe("");
  });

  it("faq_empty: an empty faqs array does NOT serialise FAQPage", () => {
    const out = buildFaqJsonLd({ faqs: [] });
    expect(out).not.toContain("FAQPage");
    expect(out).not.toContain("@type");
  });

  it("buildFaqJsonLd emits FAQPage when faqs has items", () => {
    const out = buildFaqJsonLd({
      faqs: [
        { question: "Q1?", answer: "A1." },
        { question: "Q2?", answer: "A2." },
      ],
    });
    expect(out).toContain('"@type":"FAQPage"');
    expect(out).toContain('"@type":"Question"');
    expect(out).toContain('"@type":"Answer"');
    // Two mainEntity entries
    const parsed = JSON.parse(out);
    expect(parsed.mainEntity.length).toBe(2);
    expect(parsed.mainEntity[0].name).toBe("Q1?");
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe("A1.");
  });

  it("buildHomeJsonLd returns 3 JSON-LD payloads: WebSite + Organization + ItemList", () => {
    const out = buildHomeJsonLd({
      site: SITE,
      featured: [
        { title: "F1", slug: "f1" },
        { title: "F2", slug: "f2" },
      ],
    });
    expect(out.length).toBe(3);
    const types = out.map((s) => JSON.parse(s)["@type"]);
    expect(types).toEqual(["WebSite", "Organization", "ItemList"]);
    const itemListRaw = out[2] ?? "";
    const itemList = JSON.parse(itemListRaw);
    expect(itemList.itemListElement[0].url).toBe("https://demo.example/article/f1");
    expect(itemList.itemListElement[1].position).toBe(2);
  });

  it("buildArticleJsonLd emits a single Article with publisher Organization", () => {
    const article: SeoArticle = {
      title: "Hello World",
      slug: "hello-world",
      excerpt: "Greeting from the test fixture.",
      imageUrl: "https://cdn.example/hello.jpg",
      publishedAt: "2026-05-19T10:00:00Z",
      modifiedAt: "2026-05-19T11:00:00Z",
      author: { name: "Test Author" },
    };
    const out = buildArticleJsonLd({ site: SITE, article });
    const parsed = JSON.parse(out);
    expect(parsed["@type"]).toBe("Article");
    expect(parsed.headline).toBe("Hello World");
    expect(parsed.mainEntityOfPage).toBe("https://demo.example/article/hello-world");
    expect(parsed.author["@type"]).toBe("Person");
    expect(parsed.author.name).toBe("Test Author");
    expect(parsed.publisher["@type"]).toBe("Organization");
    expect(parsed.publisher.name).toBe("Demo Site");
    expect(parsed.dateModified).toBe("2026-05-19T11:00:00Z");
  });

  it("buildBreadcrumbJsonLd returns empty string for empty items, BreadcrumbList otherwise", () => {
    expect(buildBreadcrumbJsonLd({ site: SITE, items: [] })).toBe("");
    const out = buildBreadcrumbJsonLd({
      site: SITE,
      items: [
        { name: "Home", url: "/" },
        { name: "Tech", url: "/category/tech" },
      ],
    });
    const parsed = JSON.parse(out);
    expect(parsed["@type"]).toBe("BreadcrumbList");
    expect(parsed.itemListElement.length).toBe(2);
    expect(parsed.itemListElement[0].item).toBe("https://demo.example/");
    expect(parsed.itemListElement[1].item).toBe("https://demo.example/category/tech");
  });

  it("buildMetaTags falls back to site tagline when page description is missing", () => {
    const m = buildMetaTags({ site: SITE, page: { title: "Home", canonicalUrl: "https://demo.example/" } });
    expect(m.title).toBe("Home");
    expect(m.description).toBe("A vertical-agnostic tagline");
    expect(m.canonicalUrl).toBe("https://demo.example/");
    expect(m.ogImage).toBe(null);
  });

  it("buildMetaTags falls back to site description when both page description and tagline are missing", () => {
    const sansTagline: SeoSite = { name: SITE.name, hostname: SITE.hostname, description: SITE.description };
    const m = buildMetaTags({ site: sansTagline, page: { title: "Home" } });
    expect(m.description).toBe(SITE.description);
  });

  it("origin falls back to https://${hostname} when site.origin is absent", () => {
    const homeOut = buildHomeJsonLd({ site: { name: "X", hostname: "x.example" } });
    const websiteRaw = homeOut[0] ?? "";
    const website = JSON.parse(websiteRaw);
    expect(website.url).toBe("https://x.example");
  });

  it("no banned brand strings leak from seo builders", () => {
    const home = buildHomeJsonLd({ site: SITE, featured: [{ title: "F", slug: "f" }] }).join("\n");
    const article = buildArticleJsonLd({
      site: SITE,
      article: { title: "T", slug: "s", excerpt: "x" },
    });
    const breadcrumb = buildBreadcrumbJsonLd({
      site: SITE,
      items: [{ name: "Home", url: "/" }],
    });
    const faq = buildFaqJsonLd({ faqs: [{ question: "q", answer: "a" }] });
    const all = `${home}\n${article}\n${breadcrumb}\n${faq}`;
    expect(all).not.toContain("the" + "iwise");
    expect(all).not.toContain("The" + "IWise");
    expect(all).not.toContain("cms.kodigital.app");
  });
});
