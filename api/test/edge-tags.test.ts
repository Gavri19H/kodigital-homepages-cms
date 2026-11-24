import { describe, expect, it } from "vitest";
import {
  hostTag,
  listingTag,
  listicleTag,
  mergeTags,
  nfTag,
  quoteTag,
  siteTag,
  slugTag,
  snapTag,
} from "../src/edge/tags";

describe("edge tag helpers", () => {
  it("builds a lowercase site tag", () => {
    expect(siteTag("Site-A")).toBe("site:site-a");
  });

  it("builds a lowercase snapshot tag", () => {
    expect(snapTag("Site-A")).toBe("snap:site-a");
  });

  it("builds a lowercase not-found tag", () => {
    expect(nfTag("Site-A")).toBe("nf:site-a");
  });

  it("builds a lowercase listing tag", () => {
    expect(listingTag("Site-A")).toBe("listing:site-a");
  });

  it("lowercases both the site ID and slug in a slug tag", () => {
    expect(slugTag("Site-A", "My-Article")).toBe("slug:site-a:my-article");
  });

  it("builds a lowercase listicle tag", () => {
    expect(listicleTag("Listicle-A")).toBe("listicle:listicle-a");
  });

  it("builds a lowercase quote tag", () => {
    expect(quoteTag("Quote-A")).toBe("quote:quote-a");
  });

  it("builds a lowercase host tag", () => {
    expect(hostTag("Example.COM")).toBe("host:example.com");
  });
});

describe("mergeTags", () => {
  it("lowercases and deduplicates across lists in first-seen order", () => {
    expect(mergeTags(["SITE:B", "Site:A", "site:b"], ["SITE:A", "QUOTE:Q"])).toEqual([
      "site:b",
      "site:a",
      "quote:q",
    ]);
  });

  it("drops empty strings and handles an empty merge", () => {
    expect(mergeTags(["", "SITE:A"], [], [""])).toEqual(["site:a"]);
    expect(mergeTags()).toEqual([]);
  });

  it("keeps the first 100 distinct normalized tags", () => {
    const tags = Array.from({ length: 105 }, (_, index) => `site:${index}`);
    expect(mergeTags(["", "SITE:0"], tags)).toEqual(tags.slice(0, 100));
  });
});
