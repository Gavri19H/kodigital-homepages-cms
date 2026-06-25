// rescue-6 (agent-readiness M6): operator official-profile links become
// schema.org Organization sameAs on the public home. Parser keeps only real
// http(s) URLs (a broken sameAs is worse than none); emitter includes them.
import { describe, it, expect } from "vitest";
import {
  parseSameAsList,
  renderHomeOrganizationJsonLd,
} from "../src/public/templates/jsonld-home-category-page";

describe("parseSameAsList (agent-readiness M6)", () => {
  it("keeps only absolute http(s) URLs, splits on newline/comma, dedupes", () => {
    const out = parseSameAsList(
      "https://en.wikipedia.org/wiki/X\nhttps://www.wikidata.org/wiki/Q1, https://linkedin.com/company/x\nnot-a-url\nhttps://en.wikipedia.org/wiki/X",
    );
    expect(out).toEqual([
      "https://en.wikipedia.org/wiki/X",
      "https://www.wikidata.org/wiki/Q1",
      "https://linkedin.com/company/x",
    ]);
  });

  it("drops empty / garbage / non-http schemes", () => {
    expect(parseSameAsList(undefined)).toEqual([]);
    expect(parseSameAsList("")).toEqual([]);
    expect(parseSameAsList("ftp://x, /relative, javascript:alert(1)")).toEqual([]);
  });
});

describe("renderHomeOrganizationJsonLd sameAs (agent-readiness M6)", () => {
  it("emits sameAs when present and omits it when empty", () => {
    const withSame = renderHomeOrganizationJsonLd({
      url: "https://x.test/",
      name: "X",
      sameAs: ["https://en.wikipedia.org/wiki/X"],
    });
    expect(withSame).toContain('"sameAs"');
    expect(withSame).toContain("https://en.wikipedia.org/wiki/X");

    const without = renderHomeOrganizationJsonLd({
      url: "https://x.test/",
      name: "X",
      sameAs: [],
    });
    expect(without).not.toContain('"sameAs"');
  });
});
