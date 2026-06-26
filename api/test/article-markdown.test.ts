// rescue-6 (agent-readiness M2/M5): article markdown renderer + Accept
// negotiation. Markdown is a low-cost bonus for coding agents / pasted-URL
// flows; browsers and AI-search crawlers keep getting HTML.
import { describe, it, expect } from "vitest";
import { renderArticleMarkdown } from "../src/public/article-markdown";
import { acceptPrefersMarkdown } from "../src/public/router";

describe("renderArticleMarkdown (agent-readiness M2/M5)", () => {
  it("renders title, subtitle, and the main block types as markdown", () => {
    const md = renderArticleMarkdown({
      title: "Best Trail Shoes",
      subtitle: "Our 2026 picks",
      body: [
        { type: "paragraph", text: "Intro paragraph." },
        { type: "heading", level: 2, text: "Top pick" },
        { type: "list", ordered: false, items: ["One", "Two"] },
        { type: "quote", text: "A quote", cite: "Someone" },
        {
          type: "affiliate",
          title: "Shoe A",
          description: "Waterproof.",
          url: "https://m.test/a",
          cta: "Buy",
        },
        { type: "faq", question: "Q1?", answer: "A1." },
        { type: "html", html: "<p>raw <b>html</b></p>" },
      ],
    });
    expect(md.startsWith("# Best Trail Shoes")).toBe(true);
    expect(md).toContain("*Our 2026 picks*");
    expect(md).toContain("## Top pick");
    expect(md).toContain("- One");
    expect(md).toContain("> A quote");
    expect(md).toContain("[Buy](https://m.test/a)");
    expect(md).toContain("**Q1?**");
    // html block is tag-stripped to text
    expect(md).toContain("raw html");
    expect(md).not.toContain("<b>");
  });
});

describe("acceptPrefersMarkdown (agent-readiness M5)", () => {
  it("true when the client prefers markdown", () => {
    expect(acceptPrefersMarkdown("text/markdown")).toBe(true);
    expect(acceptPrefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
  });
  it("false for a normal browser or generic Accept", () => {
    expect(
      acceptPrefersMarkdown(
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ),
    ).toBe(false);
    expect(acceptPrefersMarkdown("*/*")).toBe(false);
    expect(acceptPrefersMarkdown(undefined)).toBe(false);
    expect(acceptPrefersMarkdown("")).toBe(false);
  });
  it("false when HTML is explicitly preferred over markdown", () => {
    expect(acceptPrefersMarkdown("text/markdown;q=0.5, text/html;q=1.0")).toBe(false);
  });
});
