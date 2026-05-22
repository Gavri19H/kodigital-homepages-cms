import { describe, it, expect } from "vitest";
import {
  renderSeoHead,
  buildCanonicalUrl,
} from "../src/public/templates/seo-head";

describe("T8 renderSeoHead: canonical URL", () => {
  it("emits <link rel=\"canonical\"> built from canonicalHost + path", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/article/hello",
      title: "Hello world",
    });
    expect(html).toContain(
      '<link rel="canonical" href="https://example.com/article/hello">',
    );
  });

  it("uses explicit canonicalUrl override when supplied", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/article/hello",
      title: "Hello world",
      canonicalUrl: "https://example.com/category/news",
    });
    expect(html).toContain(
      '<link rel="canonical" href="https://example.com/category/news">',
    );
  });

  it("T8-AC3: never substitutes the admin host as a content-page canonical", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "Home",
    });
    expect(html).not.toMatch(/cms\.kodigital\.app/);
  });

  it("normalizes the path: strips trailing slashes except root", () => {
    const a = renderSeoHead({
      canonicalHost: "example.com",
      path: "/article/foo/",
      title: "T",
    });
    expect(a).toContain('href="https://example.com/article/foo"');
    const root = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "T",
    });
    expect(root).toContain('href="https://example.com/"');
  });

  it("normalizes the host: strips scheme + trailing slash + lowercases", () => {
    const html = renderSeoHead({
      canonicalHost: "HTTPS://Example.COM/",
      path: "/foo",
      title: "T",
    });
    expect(html).toContain(
      '<link rel="canonical" href="https://example.com/foo">',
    );
  });

  it("throws when canonicalHost is empty (T8-AC3 boundary)", () => {
    expect(() =>
      renderSeoHead({ canonicalHost: "", path: "/", title: "T" }),
    ).toThrow();
  });
});

describe("T8 renderSeoHead: required wire tags (T8-AC2)", () => {
  it("emits og:title + og:url + twitter:card on separate tags", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/article/hello",
      title: "Hello",
    });
    expect(html).toMatch(
      /<meta property="og:title" content="Hello">/,
    );
    expect(html).toMatch(
      /<meta property="og:url" content="https:\/\/example\.com\/article\/hello">/,
    );
    expect(html).toMatch(
      /<meta name="twitter:card" content="summary_large_image">/,
    );
  });

  it("og:url tracks the explicit canonicalUrl override (single source of truth)", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/x",
      title: "T",
      canonicalUrl: "https://example.com/canonical",
    });
    expect(html).toContain(
      '<meta property="og:url" content="https://example.com/canonical">',
    );
  });

  it("falls back to title for og:title when ogTitle is omitted", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "Site Name",
    });
    expect(html).toContain('<meta property="og:title" content="Site Name">');
  });

  it("respects explicit ogTitle / ogDescription / ogImage", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/article/foo",
      title: "fallback title",
      ogTitle: "OG Title",
      ogDescription: "OG Description",
      ogImage: "https://example.com/img.jpg",
    });
    expect(html).toContain('<meta property="og:title" content="OG Title">');
    expect(html).toContain(
      '<meta property="og:description" content="OG Description">',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://example.com/img.jpg">',
    );
  });

  it("respects twitterCard override", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "T",
      twitterCard: "summary",
    });
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });
});

describe("T8 renderSeoHead: HTML escaping", () => {
  it("escapes &, <, >, \" in title", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: 'Tom & Jerry <script>alert("x")</script>',
    });
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<script>");
  });

  it("escapes description and og fields", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "T",
      description: 'A "quoted" description with <html>',
      ogDescription: 'OG "quoted"',
    });
    expect(html).toContain("&quot;quoted&quot;");
    expect(html).toContain("&lt;html&gt;");
  });
});

describe("T8 renderSeoHead: robots", () => {
  it("defaults to index, follow", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "T",
    });
    expect(html).toContain('<meta name="robots" content="index, follow">');
  });

  it("accepts explicit robots policy (noindex)", () => {
    const html = renderSeoHead({
      canonicalHost: "example.com",
      path: "/",
      title: "T",
      robots: "noindex, nofollow",
    });
    expect(html).toContain(
      '<meta name="robots" content="noindex, nofollow">',
    );
  });
});

describe("T8 buildCanonicalUrl", () => {
  it("builds https://{host}{path} for normal inputs", () => {
    expect(buildCanonicalUrl("example.com", "/foo")).toBe(
      "https://example.com/foo",
    );
  });

  it("strips scheme + trailing slash from host", () => {
    expect(buildCanonicalUrl("HTTPS://Example.COM/", "/foo")).toBe(
      "https://example.com/foo",
    );
  });

  it("throws when host is empty / whitespace", () => {
    expect(() => buildCanonicalUrl("", "/")).toThrow();
    expect(() => buildCanonicalUrl("   ", "/")).toThrow();
  });
});
