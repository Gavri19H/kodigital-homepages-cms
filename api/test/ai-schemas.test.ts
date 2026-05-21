import { describe, it, expect } from "vitest";
import {
  assertGeneratedArticleValid,
  GeneratedArticleValidationError,
  validateGeneratedArticle,
  type GeneratedAboutPage,
  type GeneratedAltText,
  type GeneratedArticle,
  type GeneratedArticleSEO,
  type GeneratedImagePrompt,
  type GeneratedMeta,
  type GeneratedSiteSettings,
  type GeneratedStarterArticlePlan,
} from "../src/ai/schemas";

const META: GeneratedMeta = {
  task: "starter-article",
  model: "gpt-5.5",
  prompt_version: "starter-article:v1",
  status: "success",
};

function makeValidArticle(overrides: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    meta: META,
    site_id: "site-a",
    slug: "hello-world",
    title: "Hello world",
    intro: "An introduction to the topic.",
    sections: [
      {
        heading: { level: 2, text: "First section" },
        paragraphs: ["Some prose."],
      },
      {
        heading: { level: 2, text: "Second section" },
        paragraphs: ["More prose."],
      },
      {
        heading: { level: 2, text: "Third section" },
        paragraphs: ["Final prose."],
      },
    ],
    faqs: [
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
      { question: "Q3?", answer: "A3." },
    ],
    ...overrides,
  };
}

describe("T3 GeneratedArticle validator", () => {
  it("accepts a happy-path article with 3 h2 sections and 3 FAQs", () => {
    const errors = validateGeneratedArticle(makeValidArticle());
    expect(errors).toEqual([]);
    expect(() => assertGeneratedArticleValid(makeValidArticle())).not.toThrow();
  });

  it("rejects an article with only 2 h2 sections", () => {
    const article = makeValidArticle({
      sections: [
        { heading: { level: 2, text: "Only section A" }, paragraphs: ["x"] },
        { heading: { level: 2, text: "Only section B" }, paragraphs: ["y"] },
      ],
    });
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "TOO_FEW_H2_SECTIONS")).toBe(true);
    expect(() => assertGeneratedArticleValid(article)).toThrow(
      GeneratedArticleValidationError,
    );
  });

  it("counts level=3 headings as not h2 (only level=2 counts)", () => {
    const article = makeValidArticle({
      sections: [
        { heading: { level: 2, text: "h2 one" }, paragraphs: ["p"] },
        { heading: { level: 2, text: "h2 two" }, paragraphs: ["p"] },
        { heading: { level: 3, text: "h3" }, paragraphs: ["p"] },
      ],
    });
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "TOO_FEW_H2_SECTIONS")).toBe(true);
  });

  it("rejects an article with fewer than 3 FAQs", () => {
    const article = makeValidArticle({
      faqs: [
        { question: "Q1?", answer: "A1." },
        { question: "Q2?", answer: "A2." },
      ],
    });
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "TOO_FEW_FAQS")).toBe(true);
  });

  it("rejects an article whose body contains placeholder text 'lorem ipsum'", () => {
    const article = makeValidArticle({
      sections: [
        {
          heading: { level: 2, text: "Section" },
          paragraphs: ["Lorem ipsum dolor sit amet"],
        },
        { heading: { level: 2, text: "Two" }, paragraphs: ["body"] },
        { heading: { level: 2, text: "Three" }, paragraphs: ["body"] },
      ],
    });
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "PLACEHOLDER_TEXT")).toBe(true);
  });

  it("rejects an article that references 'TheIWise'", () => {
    const article = makeValidArticle({
      intro: "We at TheIWise believe...",
    });
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "BANNED_LEGACY_REF")).toBe(true);
  });

  it("rejects an article that references other banned legacy refs (insureprimo)", () => {
    const article = makeValidArticle({
      faqs: [
        { question: "Q1?", answer: "Refer to insureprimo for more." },
        { question: "Q2?", answer: "A2." },
        { question: "Q3?", answer: "A3." },
      ],
    });
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "BANNED_LEGACY_REF")).toBe(true);
  });

  it("rejects a non-object input", () => {
    // @ts-expect-error - exercising the runtime guard for malformed input
    const errors = validateGeneratedArticle(null);
    expect(errors[0]?.code).toBe("ARTICLE_NOT_OBJECT");
  });

  it("rejects articles missing site_id / slug / title", () => {
    const article = makeValidArticle();
    // @ts-expect-error - exercising the runtime guard
    delete article.site_id;
    // @ts-expect-error - exercising the runtime guard
    delete article.slug;
    const errors = validateGeneratedArticle(article);
    expect(errors.some((e) => e.code === "MISSING_SITE_ID")).toBe(true);
    expect(errors.some((e) => e.code === "MISSING_SLUG")).toBe(true);
  });
});

describe("T3 type identifiers are exported (compile-time)", () => {
  it("each generated content type is structurally constructable", () => {
    const siteSettings: GeneratedSiteSettings = {
      meta: META,
      site_id: "site-a",
      tagline: "tagline",
      description: "desc",
    };
    const about: GeneratedAboutPage = {
      meta: META,
      site_id: "site-a",
      title: "About",
      body: [{ type: "p", text: "intro" }],
    };
    const plan: GeneratedStarterArticlePlan = {
      meta: META,
      site_id: "site-a",
      items: [{ slug: "a", title: "A", summary: "s" }],
    };
    const seo: GeneratedArticleSEO = {
      meta: META,
      site_id: "site-a",
      article_slug: "a",
      meta_title: "t",
      meta_description: "d",
    };
    const alt: GeneratedAltText = {
      meta: META,
      site_id: "site-a",
      media_id: "m1",
      alt_text: "alt",
    };
    const imagePrompt: GeneratedImagePrompt = {
      meta: META,
      site_id: "site-a",
      target_kind: "logo",
      prompt: "p",
      size: "1024x1024",
    };

    expect(siteSettings.tagline).toBe("tagline");
    expect(about.body[0]?.type).toBe("p");
    expect(plan.items[0]?.slug).toBe("a");
    expect(seo.meta_title).toBe("t");
    expect(alt.alt_text).toBe("alt");
    expect(imagePrompt.target_kind).toBe("logo");
  });
});
