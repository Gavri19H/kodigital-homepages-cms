// rescue-6 (agent-readiness M2/Product): the affiliate Product/Offer JSON-LD
// emitter — an ItemList of Product nodes with offer URLs so AI shopping agents
// can discover an affiliate article's recommendations. No price/rating is ever
// fabricated (the affiliate block carries none; an invented rating would be a
// Google penalty and dishonest).
import { describe, it, expect } from "vitest";
import { renderAffiliateProductsJsonLd } from "../src/public/templates/jsonld-article";

describe("renderAffiliateProductsJsonLd (agent-readiness M2/Product)", () => {
  it("returns empty string when there are no products (no empty ItemList)", () => {
    expect(renderAffiliateProductsJsonLd({ listName: "x", products: [] })).toBe("");
  });

  it("emits an ItemList of Product nodes with Offer urls and NO fabricated price/rating", () => {
    const out = renderAffiliateProductsJsonLd({
      listName: "Best trail shoes",
      products: [
        { name: "Shoe A", url: "https://merchant.example/a?ref=aff", description: "Waterproof." },
        { name: "Shoe B", url: "https://merchant.example/b?ref=aff" },
      ],
    });
    expect(out).toContain('<script type="application/ld+json">');
    expect(out).toContain('"@type": "ItemList"');
    expect(out).toContain('"name": "Best trail shoes"');
    expect(out).toContain('"@type": "Product"');
    expect(out).toContain('"name": "Shoe A"');
    expect(out).toContain('"description": "Waterproof."');
    expect(out).toContain('"@type": "Offer"');
    expect(out).toContain('"url": "https://merchant.example/a?ref=aff"');
    expect(out).toContain('"position": 2');
    expect(out).not.toContain('"price"');
    expect(out).not.toContain('"aggregateRating"');
    expect(out).not.toContain('"reviewRating"');
  });

  it("omits description + offers when absent but still names the Product", () => {
    const out = renderAffiliateProductsJsonLd({
      listName: "L",
      products: [{ name: "Bare Product" }],
    });
    expect(out).toContain('"name": "Bare Product"');
    expect(out).not.toContain('"@type": "Offer"');
    expect(out).not.toContain('"description"');
  });
});
