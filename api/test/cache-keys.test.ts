import { describe, it, expect } from "vitest";
import {
  TEMPLATE_VERSION,
  htmlKey,
  homepageDataKey,
  articleKey,
  categoryKey,
  pageKey,
  sitemapKey,
  feedRssKey,
  feedAtomKey,
  settingsKey,
  robotsKey,
  adsKey,
  leadgenShellKey,
  leadgenConfigKey,
} from "../src/cache/cache-keys";

const SITE_ID = "st_abc";

describe("cache-keys: TEMPLATE_VERSION constant", () => {
  it("is a finite positive integer", () => {
    expect(Number.isInteger(TEMPLATE_VERSION)).toBe(true);
    expect(TEMPLATE_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("cache-keys: html / homepage-data / article / category / page", () => {
  it("htmlKey includes site_id, path, content_version, template_version (in that order)", () => {
    expect(htmlKey(SITE_ID, "/article/foo", 5)).toBe(
      `html:${SITE_ID}:/article/foo:5:${TEMPLATE_VERSION}`,
    );
  });

  it("htmlKey strips trailing slashes except for root path", () => {
    expect(htmlKey(SITE_ID, "/article/foo/", 5)).toBe(
      `html:${SITE_ID}:/article/foo:5:${TEMPLATE_VERSION}`,
    );
    expect(htmlKey(SITE_ID, "/", 1)).toBe(
      `html:${SITE_ID}:/:1:${TEMPLATE_VERSION}`,
    );
  });

  it("htmlKey prepends a leading slash when missing", () => {
    expect(htmlKey(SITE_ID, "article/bar", 2)).toBe(
      `html:${SITE_ID}:/article/bar:2:${TEMPLATE_VERSION}`,
    );
  });

  it("homepageDataKey is namespaced homepage-data and omits template_version", () => {
    expect(homepageDataKey(SITE_ID, 7)).toBe(`homepage-data:${SITE_ID}:7`);
  });

  it("articleKey carries slug + content_version + template_version", () => {
    expect(articleKey(SITE_ID, "hello-world", 3)).toBe(
      `article:${SITE_ID}:hello-world:3:${TEMPLATE_VERSION}`,
    );
  });

  it("categoryKey carries slug + page + content_version + template_version", () => {
    expect(categoryKey(SITE_ID, "news", 2, 4)).toBe(
      `category:${SITE_ID}:news:2:4:${TEMPLATE_VERSION}`,
    );
  });

  it("pageKey carries slug + content_version + template_version", () => {
    expect(pageKey(SITE_ID, "about", 9)).toBe(
      `page:${SITE_ID}:about:9:${TEMPLATE_VERSION}`,
    );
  });
});

describe("cache-keys: sitemap / feeds (content_version, no template_version)", () => {
  it("sitemapKey uses content_version only", () => {
    expect(sitemapKey(SITE_ID, 6)).toBe(`sitemap:${SITE_ID}:6`);
  });

  it("feedRssKey uses feed:rss namespace and content_version only", () => {
    expect(feedRssKey(SITE_ID, 11)).toBe(`feed:rss:${SITE_ID}:11`);
  });

  it("feedAtomKey uses feed:atom namespace and content_version only", () => {
    expect(feedAtomKey(SITE_ID, 12)).toBe(`feed:atom:${SITE_ID}:12`);
  });
});

describe("cache-keys: settings / robots / ads (settings_version, no template_version)", () => {
  it("settingsKey uses settings_version", () => {
    expect(settingsKey(SITE_ID, 1)).toBe(`settings:${SITE_ID}:1`);
  });

  it("robotsKey uses settings_version", () => {
    expect(robotsKey(SITE_ID, 2)).toBe(`robots:${SITE_ID}:2`);
  });

  it("adsKey uses settings_version", () => {
    expect(adsKey(SITE_ID, 3)).toBe(`ads:${SITE_ID}:3`);
  });
});

describe("cache-keys: site_id RED-LINE protection", () => {
  it("htmlKey throws when site_id is empty", () => {
    expect(() => htmlKey("", "/x", 1)).toThrow(/site_id/);
  });

  it("htmlKey throws when site_id is whitespace-only", () => {
    expect(() => htmlKey("   ", "/x", 1)).toThrow(/site_id/);
  });

  it("articleKey throws when site_id is empty", () => {
    expect(() => articleKey("", "slug", 1)).toThrow(/site_id/);
  });

  it("settingsKey throws when site_id is empty", () => {
    expect(() => settingsKey("", 1)).toThrow(/site_id/);
  });
});

describe("cache-keys: site_id-first prefix discipline", () => {
  // Per proposal.md "Chosen": site_id MUST be the first component after the
  // namespace so env.CACHE.list({ prefix: "html:st_abc:" }) scopes scans to
  // one tenant. Verify each builder satisfies that invariant.
  const cases: Array<[string, string]> = [
    [htmlKey(SITE_ID, "/x", 1), "html:"],
    [homepageDataKey(SITE_ID, 1), "homepage-data:"],
    [articleKey(SITE_ID, "x", 1), "article:"],
    [categoryKey(SITE_ID, "x", 1, 1), "category:"],
    [pageKey(SITE_ID, "x", 1), "page:"],
    [sitemapKey(SITE_ID, 1), "sitemap:"],
    [feedRssKey(SITE_ID, 1), "feed:rss:"],
    [feedAtomKey(SITE_ID, 1), "feed:atom:"],
    [settingsKey(SITE_ID, 1), "settings:"],
    [robotsKey(SITE_ID, 1), "robots:"],
    [adsKey(SITE_ID, 1), "ads:"],
  ];

  for (const [key, expectedPrefix] of cases) {
    it(`${expectedPrefix}<site_id>:... — ${key}`, () => {
      expect(key.startsWith(`${expectedPrefix}${SITE_ID}:`)).toBe(true);
    });
  }
});

describe("cache-keys: leadgen activation_version axis (§28 GA4 cache-coherence — P14 finding 1)", () => {
  const S = "st_0123456789abcdef";
  const F = "lgf_funnel00000000000000000";
  const V = "lgn_variant0000000000000000";

  it("leadgenShellKey CHANGES when activation_version (a settings/GA4 edit → updated_at bump) changes, same content_version", () => {
    // BEFORE the fix the GA4 id was baked into the body but NOT the key, so a
    // settings-only edit (no content_version move) reused the stale-id key/ETag.
    const k1 = leadgenShellKey(S, "auto", F, V, 3, 1_700_000_000);
    const k2 = leadgenShellKey(S, "auto", F, V, 3, 1_700_000_500);
    expect(k1).not.toBe(k2);
    expect(k1.endsWith(":1700000000")).toBe(true);
    expect(k2.endsWith(":1700000500")).toBe(true);
  });

  it("leadgenConfigKey CHANGES when activation_version changes, same content_version + ab_rev", () => {
    const k1 = leadgenConfigKey(S, F, V, 3, 0, 1_700_000_000);
    const k2 = leadgenConfigKey(S, F, V, 3, 0, 1_700_000_500);
    expect(k1).not.toBe(k2);
  });

  it("the per-site invalidation prefix + the funnel-narrowing segment stay intact (suffix appended, not inserted)", () => {
    const k = leadgenShellKey(S, "auto", F, V, 3, 1_700_000_000);
    expect(k.startsWith(`lg-shell:${S}:`)).toBe(true); // invalidateOnQuoteActivation prefix
    expect(k.split(":")[3]).toBe(F); // invalidateOnVariantPublish funnel segment (index 3)
  });
});
