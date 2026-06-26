// rescue-6 (agent-readiness M1/M2): buildLlmsTxt emits the llmstxt.org
// structure for /llms.txt (H1 site name, blockquote summary, H2 link section).
import { describe, it, expect } from "vitest";
import { buildLlmsTxt } from "../src/public/sitemap";

describe("buildLlmsTxt (agent-readiness M1/M2)", () => {
  it("emits H1 name, blockquote summary, and an H2 link section", () => {
    const out = buildLlmsTxt({
      siteName: "Demo",
      description: "A demo site.",
      baseUrl: "https://demo.test/",
    });
    expect(out.startsWith("# Demo")).toBe(true);
    expect(out).toContain("> A demo site.");
    expect(out).toContain("## Site");
    expect(out).toContain("[Sitemap](https://demo.test/sitemap.xml)");
    expect(out).toContain("[RSS feed](https://demo.test/feed.xml)");
    // trailing slash on baseUrl is normalised (no //sitemap.xml)
    expect(out).not.toContain("https://demo.test//sitemap.xml");
  });

  it("falls back to tagline, then a generic summary", () => {
    expect(
      buildLlmsTxt({ siteName: "X", tagline: "My tagline", baseUrl: "https://x.test" }),
    ).toContain("> My tagline");
    expect(buildLlmsTxt({ siteName: "X", baseUrl: "https://x.test" })).toContain(
      "> X: articles and guides.",
    );
  });
});
