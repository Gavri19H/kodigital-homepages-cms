import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderHomeWebsiteJsonLd,
  renderHomeOrganizationJsonLd,
  renderHomeItemListJsonLd,
  renderCategoryJsonLd,
  renderWebPageJsonLd,
} from "../src/public/templates/jsonld-home-category-page";

function parseJsonLd(html: string): Record<string, unknown> {
  const open = '<script type="application/ld+json">';
  const close = "</script>";
  const startIdx = html.indexOf(open);
  const endIdx = html.lastIndexOf(close);
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error(`JSON-LD <script> markers not found in: ${html}`);
  }
  const body = html.slice(startIdx + open.length, endIdx).trim();
  return JSON.parse(body.replace(/<\\\//g, "</")) as Record<string, unknown>;
}

describe("T10 renderHomeWebsiteJsonLd: WebSite schema", () => {
  const baseInput = { url: "https://example.com/", name: "Example Homepage" };
  const tpl = "https://example.com/search?q={search_term_string}";

  it("sets @type WebSite + @context + @id + url + name", () => {
    const html = renderHomeWebsiteJsonLd(baseInput);
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain("</script>");
    const payload = parseJsonLd(html);
    expect(payload["@context"]).toBe("https://schema.org");
    expect(payload["@type"]).toBe("WebSite");
    expect(payload["@id"]).toBe("https://example.com/");
    expect(payload.url).toBe("https://example.com/");
    expect(payload.name).toBe("Example Homepage");
  });

  it("T10-AC2: OMITS potentialAction unless flag=true AND template supplied", () => {
    expect(parseJsonLd(renderHomeWebsiteJsonLd(baseInput)).potentialAction).toBeUndefined();
    expect(parseJsonLd(renderHomeWebsiteJsonLd({ ...baseInput, searchRouteEnabled: false, searchUrlTemplate: tpl })).potentialAction).toBeUndefined();
    expect(parseJsonLd(renderHomeWebsiteJsonLd({ ...baseInput, searchRouteEnabled: true })).potentialAction).toBeUndefined();
  });

  it("T10-AC2: EMITS SearchAction only when flag + template both supplied", () => {
    const payload = parseJsonLd(
      renderHomeWebsiteJsonLd({ ...baseInput, searchRouteEnabled: true, searchUrlTemplate: tpl }),
    );
    const pa = payload.potentialAction as Record<string, unknown>;
    expect(pa["@type"]).toBe("SearchAction");
    const target = pa.target as Record<string, unknown>;
    expect(target["@type"]).toBe("EntryPoint");
    expect(target.urlTemplate).toBe(tpl);
    expect(pa["query-input"]).toBe("required name=search_term_string");
  });

  it("never substitutes a default host (T8/T10 tenant-boundary)", () => {
    expect(renderHomeWebsiteJsonLd(baseInput)).not.toMatch(/cms\.kodigital\.app/);
  });
});

describe("T10 renderHomeOrganizationJsonLd: Organization schema", () => {
  it("emits Organization with ImageObject logo + sameAs when supplied", () => {
    const p = parseJsonLd(
      renderHomeOrganizationJsonLd({
        url: "https://example.com/",
        name: "Example Publisher",
        logoUrl: "https://example.com/img/logo.png",
        sameAs: ["https://twitter.com/x"],
      }),
    );
    expect(p["@type"]).toBe("Organization");
    expect(p.url).toBe("https://example.com/");
    expect(p.name).toBe("Example Publisher");
    const logo = p.logo as Record<string, unknown>;
    expect(logo["@type"]).toBe("ImageObject");
    expect(logo.url).toBe("https://example.com/img/logo.png");
    expect(p.sameAs).toEqual(["https://twitter.com/x"]);
  });

  it("omits logo + sameAs when not supplied / empty", () => {
    const p = parseJsonLd(
      renderHomeOrganizationJsonLd({ url: "https://example.com/", name: "Min", sameAs: [] }),
    );
    expect(p.logo).toBeUndefined();
    expect(p.sameAs).toBeUndefined();
  });
});

describe("T10 renderHomeItemListJsonLd: ItemList schema", () => {
  it("renders 1-indexed ListItem entries + optional listName", () => {
    const payload = parseJsonLd(
      renderHomeItemListJsonLd({
        items: [
          { name: "First", url: "https://example.com/a/first" },
          { name: "Second", url: "https://example.com/a/second" },
          { name: "Third", url: "https://example.com/a/third" },
        ],
        listName: "Latest stories",
      }),
    );
    expect(payload["@type"]).toBe("ItemList");
    expect(payload.name).toBe("Latest stories");
    const items = payload.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    const first = items[0]!;
    const third = items[2]!;
    expect(first["@type"]).toBe("ListItem");
    expect(first.position).toBe(1);
    expect(first.name).toBe("First");
    expect(third.position).toBe(3);
  });

  it("emits an empty itemListElement when items is []", () => {
    const payload = parseJsonLd(renderHomeItemListJsonLd({ items: [] }));
    expect(payload.itemListElement).toEqual([]);
    expect(payload.name).toBeUndefined();
  });
});

describe("T10 renderCategoryJsonLd: CollectionPage schema", () => {
  it("sets @type CollectionPage + mainEntity ItemList of articles", () => {
    const payload = parseJsonLd(
      renderCategoryJsonLd({
        url: "https://example.com/category/news",
        name: "News",
        description: "Latest news from Example.",
        articles: [
          { name: "Story A", url: "https://example.com/article/story-a" },
          { name: "Story B", url: "https://example.com/article/story-b" },
        ],
      }),
    );
    expect(payload["@type"]).toBe("CollectionPage");
    expect(payload["@id"]).toBe("https://example.com/category/news");
    expect(payload.name).toBe("News");
    expect(payload.description).toBe("Latest news from Example.");
    const main = payload.mainEntity as Record<string, unknown>;
    expect(main["@type"]).toBe("ItemList");
    const items = main.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    const first = items[0]!;
    expect(first.position).toBe(1);
    expect(first.name).toBe("Story A");
  });

  it("omits description when not supplied + tenant-boundary holds", () => {
    const html = renderCategoryJsonLd({
      url: "https://example.com/category/sports",
      name: "Sports",
      articles: [],
    });
    expect(parseJsonLd(html).description).toBeUndefined();
    expect(html).not.toMatch(/cms\.kodigital\.app/);
  });
});

describe("T10 renderWebPageJsonLd: WebPage schema", () => {
  it("emits WebPage with optional fields omitted by default", () => {
    const p = parseJsonLd(
      renderWebPageJsonLd({ url: "https://example.com/about", name: "About" }),
    );
    expect(p["@type"]).toBe("WebPage");
    expect(p["@id"]).toBe("https://example.com/about");
    expect(p.url).toBe("https://example.com/about");
    expect(p.name).toBe("About");
    expect(p.datePublished).toBeUndefined();
    expect(p.dateModified).toBeUndefined();
    expect(p.inLanguage).toBeUndefined();
    expect(p.description).toBeUndefined();
  });

  it("emits description + dates + inLanguage when supplied", () => {
    const p = parseJsonLd(
      renderWebPageJsonLd({
        url: "https://example.com/terms",
        name: "Terms",
        description: "Terms.",
        datePublished: "2026-05-22T10:00:00Z",
        dateModified: "2026-05-22T11:00:00Z",
        inLanguage: "en-US",
      }),
    );
    expect(p.description).toBe("Terms.");
    expect(p.datePublished).toBe("2026-05-22T10:00:00Z");
    expect(p.dateModified).toBe("2026-05-22T11:00:00Z");
    expect(p.inLanguage).toBe("en-US");
  });
});

describe("T10 </script> XSS guard (mirrors T9)", () => {
  it("neutralizes </script in a tenant-supplied name", () => {
    const html = renderHomeWebsiteJsonLd({
      url: "https://example.com/",
      name: "Evil </script><script>alert(1)</script>",
    });
    const matches = html.match(/<\/script/gi) ?? [];
    expect(matches.length).toBe(1);
    expect(html).toContain("<\\/script");
  });
});

// T26: cross-emitter SearchAction red line. Phase 7 ships no /search
// route, so SearchAction MUST be omitted from every home/category/page
// JSON-LD unless BOTH searchRouteEnabled=true AND searchUrlTemplate are
// supplied. A regression that adds a stray SearchAction to any non-Website
// emitter, or that fires SearchAction with only one half of the gate, is
// a test failure here.
describe("T26 SearchAction-omitted red line (no /search route in Phase 7)", () => {
  const home = { url: "https://example.com/", name: "Example" };
  const tpl = "https://example.com/search?q={search_term_string}";

  it.each([
    ["default (no flag, no template)", home],
    ["flag without template", { ...home, searchRouteEnabled: true }],
    ["template without flag", { ...home, searchUrlTemplate: tpl }],
    ["flag explicitly false", { ...home, searchRouteEnabled: false, searchUrlTemplate: tpl }],
  ])("WebSite %s emits no SearchAction", (_label, input) => {
    const html = renderHomeWebsiteJsonLd(input);
    expect(html).not.toMatch(/SearchAction/);
    expect(parseJsonLd(html).potentialAction).toBeUndefined();
  });

  it.each<[string, string]>([
    ["Organization", renderHomeOrganizationJsonLd({
      url: "https://example.com/",
      name: "Example Publisher",
      logoUrl: "https://example.com/img/logo.png",
      sameAs: ["https://twitter.com/x"],
    })],
    ["ItemList", renderHomeItemListJsonLd({
      items: [{ name: "A", url: "https://example.com/a" }],
      listName: "Latest",
    })],
    ["CollectionPage", renderCategoryJsonLd({
      url: "https://example.com/category/news",
      name: "News",
      articles: [{ name: "Story A", url: "https://example.com/article/a" }],
    })],
    ["WebPage", renderWebPageJsonLd({
      url: "https://example.com/about",
      name: "About",
    })],
  ])("%s JSON-LD never emits SearchAction", (_label, html) => {
    expect(html).not.toMatch(/SearchAction/);
  });
});

// T26-AC2: public router source MUST NOT register a GET /search route.
// Read the router file directly so adding /search (in any common shape)
// is a test failure even when no functional test exercises the route.
describe("T26-AC2 public router has no GET /search route", () => {
  const routerSrc = readFileSync(
    resolve(__dirname, "..", "src", "public", "router.ts"),
    "utf8",
  );

  it.each([
    ["router.get(\"/search\")", /router\.get\(\s*["']\/search["']/],
    ["router.get(\"/search/...\")", /router\.get\(\s*["']\/search\//],
    [".get(\"/search...\") on any chained shape", /\.get\(\s*["']\/search(["']|\/)/],
  ])("%s is not registered", (_label, pat) => {
    expect(routerSrc).not.toMatch(pat);
  });
});
