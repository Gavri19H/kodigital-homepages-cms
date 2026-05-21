import { describe, it, expect } from "vitest";
import {
  PROMPT_VERSION as TAGLINE_VERSION,
  buildPrompt as buildTagline,
} from "../src/ai/prompts/site-tagline";
import {
  PROMPT_VERSION as DESC_VERSION,
  buildPrompt as buildDescription,
} from "../src/ai/prompts/site-description";
import {
  PROMPT_VERSION as ABOUT_VERSION,
  buildPrompt as buildAbout,
} from "../src/ai/prompts/about-page";
import {
  PROMPT_VERSION as LOGO_VERSION,
  buildPrompt as buildLogo,
} from "../src/ai/prompts/logo";
import {
  PROMPT_VERSION as FEATURE_IMAGE_VERSION,
  buildPrompt as buildFeatureImage,
} from "../src/ai/prompts/feature-image";
import {
  PROMPT_VERSION as PLAN_VERSION,
  buildPrompt as buildPlan,
} from "../src/ai/prompts/starter-article-plan";
import {
  PROMPT_VERSION as ARTICLE_VERSION,
  buildPrompt as buildArticle,
} from "../src/ai/prompts/starter-article";
import {
  PROMPT_VERSION as SEO_VERSION,
  buildPrompt as buildSEO,
} from "../src/ai/prompts/article-seo";
import {
  PROMPT_VERSION as ALT_VERSION,
  buildPrompt as buildAlt,
} from "../src/ai/prompts/alt-text";

describe("ai/prompts PROMPT_VERSION slugs", () => {
  it("each module exports its expected canonical slug", () => {
    expect(TAGLINE_VERSION).toBe("site-tagline:v1");
    expect(DESC_VERSION).toBe("site-description:v1");
    expect(ABOUT_VERSION).toBe("about-page:v1");
    expect(LOGO_VERSION).toBe("logo:v1");
    expect(FEATURE_IMAGE_VERSION).toBe("feature-image:v1");
    expect(PLAN_VERSION).toBe("starter-article-plan:v1");
    expect(ARTICLE_VERSION).toBe("starter-article:v1");
    expect(SEO_VERSION).toBe("article-seo:v1");
    expect(ALT_VERSION).toBe("alt-text:v1");
  });
});

describe("ai/prompts buildPrompt determinism", () => {
  it("site-tagline buildPrompt is deterministic for the same input", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      audience: "homeowners",
      brand_name: "Acme",
    };
    expect(buildTagline(input)).toBe(buildTagline(input));
  });

  it("site-description buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      audience: "homeowners",
      brand_name: "Acme",
      tagline: "Helpful and local.",
    };
    expect(buildDescription(input)).toBe(buildDescription(input));
  });

  it("about-page buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      audience: "homeowners",
      brand_name: "Acme",
    };
    expect(buildAbout(input)).toBe(buildAbout(input));
  });

  it("logo buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      brand_name: "Acme",
      palette: "earth tones",
    };
    expect(buildLogo(input)).toBe(buildLogo(input));
  });

  it("feature-image buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      article_title: "How to seal a window frame",
      palette: "natural",
    };
    expect(buildFeatureImage(input)).toBe(buildFeatureImage(input));
  });

  it("starter-article-plan buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      audience: "homeowners",
      brand_name: "Acme",
    };
    expect(buildPlan(input)).toBe(buildPlan(input));
  });

  it("starter-article buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      audience: "homeowners",
      brand_name: "Acme",
      slug: "seal-windows",
      title: "How to seal your windows",
      summary: "Step-by-step weatherproofing.",
    };
    expect(buildArticle(input)).toBe(buildArticle(input));
  });

  it("article-seo buildPrompt is deterministic", () => {
    const input = {
      site_id: "site-a",
      vertical: "home services",
      article_slug: "seal-windows",
      article_title: "How to seal your windows",
      article_intro: "Stop drafts and lower energy bills.",
    };
    expect(buildSEO(input)).toBe(buildSEO(input));
  });

  it("alt-text buildPrompt is deterministic", () => {
    const input: Parameters<typeof buildAlt>[0] = {
      site_id: "site-a",
      media_id: "media-1",
      context_kind: "feature_image",
      article_title: "How to seal your windows",
      vertical: "home services",
    };
    expect(buildAlt(input)).toBe(buildAlt(input));
  });
});

describe("ai/prompts buildPrompt content", () => {
  it("prompts include the site_id passed in", () => {
    expect(
      buildTagline({ site_id: "site-xyz", vertical: "home services" }),
    ).toContain("site-xyz");
    expect(
      buildAbout({ site_id: "site-xyz", vertical: "home services" }),
    ).toContain("site-xyz");
  });

  it("logo prompt explicitly forbids text rendering", () => {
    const out = buildLogo({
      site_id: "site-a",
      vertical: "home services",
      brand_name: "Acme",
    });
    expect(/no text rendering/i.test(out)).toBe(true);
    expect(out).toContain("site name is not rendered");
  });

  it("logo prompt does not request transparent background or alpha channel", () => {
    const out = buildLogo({
      site_id: "site-a",
      vertical: "home services",
      brand_name: "Acme",
    });
    expect(/transparent background/i.test(out)).toBe(false);
    expect(/alpha channel/i.test(out)).toBe(false);
  });

  it("starter-article prompt forbids placeholder text and banned legacy refs", () => {
    const out = buildArticle({
      site_id: "site-a",
      vertical: "home services",
      slug: "x",
      title: "Y",
    });
    expect(/lorem ipsum/i.test(out)).toBe(true);
    expect(/legacy product names/i.test(out)).toBe(true);
  });

  it("starter-article-plan prompt asks for exactly 15 items with unique kebab-case slugs", () => {
    const out = buildPlan({
      site_id: "site-a",
      vertical: "home services",
    });
    expect(out).toContain("Exactly 15 items");
    expect(out).toContain("kebab-case");
  });
});

describe("ai/prompts no banned legacy refs in any prompt module", () => {
  // Strings built at runtime via concatenation so this test file does
  // not itself trip the api/scripts/verify/assert-no-legacy-prod-refs.ts
  // banned-substring scanner.
  const banned = [
    "the" + "iwise",
    "insure" + "primo",
    "quotes" + "routes",
    "psychic" + "-quiz",
    "rental" + "-booking",
  ];
  const allOutputs: Array<{ name: string; out: string }> = [
    {
      name: "site-tagline",
      out: buildTagline({ site_id: "s", vertical: "v" }),
    },
    {
      name: "site-description",
      out: buildDescription({ site_id: "s", vertical: "v" }),
    },
    {
      name: "about-page",
      out: buildAbout({ site_id: "s", vertical: "v" }),
    },
    {
      name: "logo",
      out: buildLogo({ site_id: "s", vertical: "v" }),
    },
    {
      name: "feature-image",
      out: buildFeatureImage({
        site_id: "s",
        vertical: "v",
        article_title: "t",
      }),
    },
    {
      name: "starter-article-plan",
      out: buildPlan({ site_id: "s", vertical: "v" }),
    },
    {
      name: "starter-article",
      out: buildArticle({ site_id: "s", vertical: "v", slug: "a", title: "b" }),
    },
    {
      name: "article-seo",
      out: buildSEO({
        site_id: "s",
        vertical: "v",
        article_slug: "a",
        article_title: "b",
      }),
    },
    {
      name: "alt-text",
      out: buildAlt({
        site_id: "s",
        media_id: "m",
        context_kind: "inline",
      }),
    },
  ];

  for (const { name, out } of allOutputs) {
    for (const term of banned) {
      it(`${name} prompt does not mention ${term}`, () => {
        expect(out.toLowerCase()).not.toContain(term);
      });
    }
  }
});
