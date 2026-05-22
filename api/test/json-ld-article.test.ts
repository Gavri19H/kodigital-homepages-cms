import { describe, it, expect } from "vitest";
import {
  renderArticleJsonLd,
  renderBreadcrumbJsonLd,
  renderFaqJsonLd,
} from "../src/public/templates/jsonld-article";

function parseJsonLd(html: string): Record<string, unknown> {
  const open = '<script type="application/ld+json">';
  const close = "</script>";
  const startIdx = html.indexOf(open);
  const endIdx = html.lastIndexOf(close);
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error(`JSON-LD <script> markers not found in: ${html}`);
  }
  const body = html.slice(startIdx + open.length, endIdx).trim();
  // Reverse the "<\/script" guard so JSON.parse sees clean JSON.
  return JSON.parse(body.replace(/<\\\//g, "</")) as Record<string, unknown>;
}

describe("T9 renderArticleJsonLd: Article schema", () => {
  const baseInput = {
    url: "https://example.com/article/hello",
    headline: "Hello World",
    image: "https://example.com/img/hello.jpg",
    datePublished: "2026-05-22T10:00:00Z",
    dateModified: "2026-05-22T11:30:00Z",
    authorName: "Jane Doe",
    authorUrl: "https://example.com/author/jane",
    publisherName: "Example Publisher",
    publisherLogo: "https://example.com/img/logo.png",
    description: "A short article summary used by SERP rich results.",
  };

  it("emits a <script type=\"application/ld+json\"> wrapper", () => {
    const html = renderArticleJsonLd(baseInput);
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain("</script>");
  });

  it("sets @type Article + @context schema.org", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    expect(payload["@context"]).toBe("https://schema.org");
    expect(payload["@type"]).toBe("Article");
  });

  it("T9-AC2: emits headline, author, datePublished, dateModified, image, description", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    expect(payload.headline).toBe("Hello World");
    expect(payload.datePublished).toBe("2026-05-22T10:00:00Z");
    expect(payload.dateModified).toBe("2026-05-22T11:30:00Z");
    expect(payload.image).toBe("https://example.com/img/hello.jpg");
    expect(payload.description).toBe(
      "A short article summary used by SERP rich results.",
    );
    const author = payload.author as Record<string, unknown>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe("Jane Doe");
  });

  it("T9-AC4: emits mainEntityOfPage with @type WebPage + canonical url", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    const mainEntityOfPage = payload.mainEntityOfPage as Record<string, unknown>;
    expect(mainEntityOfPage["@type"]).toBe("WebPage");
    expect(mainEntityOfPage["@id"]).toBe("https://example.com/article/hello");
  });

  it("emits a Publisher Organization with logo ImageObject when supplied", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    const publisher = payload.publisher as Record<string, unknown>;
    expect(publisher["@type"]).toBe("Organization");
    expect(publisher.name).toBe("Example Publisher");
    const logo = publisher.logo as Record<string, unknown>;
    expect(logo["@type"]).toBe("ImageObject");
    expect(logo.url).toBe("https://example.com/img/logo.png");
  });

  it("omits optional fields (image, description, section) when not supplied", () => {
    const payload = parseJsonLd(
      renderArticleJsonLd({
        url: "https://example.com/article/min",
        headline: "Minimal",
        datePublished: "2026-05-22T10:00:00Z",
        dateModified: "2026-05-22T10:00:00Z",
        authorName: "A",
        publisherName: "P",
      }),
    );
    expect(payload.image).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.articleSection).toBeUndefined();
  });

  it("emits articleSection when section is supplied", () => {
    const payload = parseJsonLd(
      renderArticleJsonLd({ ...baseInput, section: "news" }),
    );
    expect(payload.articleSection).toBe("news");
  });

  it("never substitutes a default host (T8 tenant-boundary discipline)", () => {
    const html = renderArticleJsonLd(baseInput);
    expect(html).not.toMatch(/cms\.kodigital\.app/);
  });

  it("guards against </script> early termination inside string values", () => {
    const html = renderArticleJsonLd({
      ...baseInput,
      headline: "Evil </script><script>alert(1)</script>",
    });
    // The literal </script ... > end-tag MUST appear ONLY as the closing
    // </script> of the JSON-LD wrapper, not from the embedded payload.
    const matches = html.match(/<\/script/gi) ?? [];
    expect(matches.length).toBe(1);
    // The embedded sequence must be neutered via "<\/script>".
    expect(html).toContain("<\\/script");
  });
});

describe("T9 renderBreadcrumbJsonLd: BreadcrumbList", () => {
  it("emits @type BreadcrumbList with itemListElement array", () => {
    const payload = parseJsonLd(
      renderBreadcrumbJsonLd({
        items: [
          { name: "Home", url: "https://example.com/" },
          { name: "News", url: "https://example.com/category/news" },
          { name: "Story", url: "https://example.com/article/story" },
        ],
      }),
    );
    expect(payload["@type"]).toBe("BreadcrumbList");
    const items = payload.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    const first = items[0]!;
    const third = items[2]!;
    expect(first["@type"]).toBe("ListItem");
    expect(first.position).toBe(1);
    expect(first.name).toBe("Home");
    expect(first.item).toBe("https://example.com/");
    expect(third.position).toBe(3);
    expect(third.name).toBe("Story");
  });

  it("emits an empty itemListElement array when no items supplied", () => {
    const payload = parseJsonLd(renderBreadcrumbJsonLd({ items: [] }));
    expect(payload.itemListElement).toEqual([]);
  });
});

describe("T9 renderFaqJsonLd: FAQPage", () => {
  it("emits @type FAQPage with mainEntity Question/Answer pairs", () => {
    const payload = parseJsonLd(
      renderFaqJsonLd({
        questions: [
          { question: "What is X?", answer: "X is Y." },
          { question: "How do I Z?", answer: "Click here to Z." },
        ],
      }),
    );
    expect(payload["@type"]).toBe("FAQPage");
    const main = payload.mainEntity as Record<string, unknown>[];
    expect(main).toHaveLength(2);
    const q0 = main[0]!;
    expect(q0["@type"]).toBe("Question");
    expect(q0.name).toBe("What is X?");
    const accepted = q0.acceptedAnswer as Record<string, unknown>;
    expect(accepted["@type"]).toBe("Answer");
    expect(accepted.text).toBe("X is Y.");
  });

  it("emits an empty mainEntity when no questions supplied", () => {
    const payload = parseJsonLd(renderFaqJsonLd({ questions: [] }));
    expect(payload.mainEntity).toEqual([]);
  });

  it("preserves unicode in question/answer text", () => {
    const payload = parseJsonLd(
      renderFaqJsonLd({
        questions: [{ question: "Quoi?", answer: "résumé — \"caché\"." }],
      }),
    );
    const main = payload.mainEntity as Record<string, unknown>[];
    const q0 = main[0]!;
    expect(q0.name).toBe("Quoi?");
    const accepted = q0.acceptedAnswer as Record<string, unknown>;
    expect(accepted.text).toBe("résumé — \"caché\".");
  });
});
