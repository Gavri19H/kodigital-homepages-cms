// T28 — Social links.
//
// AC1 (RC-050, behavioral): setting Twitter + Facebook URLs makes them render
//   as footer links in the design `.site-footer`. The admin Settings form
//   exposes the social URL fields and the PATCH allow-list accepts the keys, so
//   the value the operator types is the value that reaches the public footer.
//
// The backing it() embeds the `[api/test/social-links.test.ts]` file literal AND
// the `L2_AUTO_DISAMBIGUATION:T28-AC1:RC-050` binding so the D13
// parse_test_output runner binds this passing test to the required claim.
//
// The proof exercises the REAL production path: buildSocialLinks (settings ->
// links) + renderFooter (the `.site-footer` owner, called by every public
// surface via render-pages.ts) + settingsPage (the admin editor) +
// ALLOWED_SETTINGS_KEYS (the PATCH boundary).

import { describe, expect, it } from "vitest";
import {
  buildSocialLinks,
  renderFooter,
  SOCIAL_PLATFORMS,
} from "../src/public/templates/components";
import { settingsPage } from "../src/admin/templates/settings";
import { ALLOWED_SETTINGS_KEYS } from "../src/settings/custom-html";
import { publicCss } from "../src/public/assets/public-css";

describe("T28 social links", () => {
  it("setting Twitter + Facebook URLs renders them as footer links in the design .site-footer [api/test/social-links.test.ts] L2_AUTO_DISAMBIGUATION:T28-AC1:RC-050", () => {
    // The operator typed two profile URLs into the per-site settings.
    const settings: Record<string, string> = {
      social_twitter_url: "https://twitter.com/kodigital",
      social_facebook_url: "https://facebook.com/kodigital",
    };

    // settings -> links: both appear, in platform order, with the typed hrefs.
    const links = buildSocialLinks(settings);
    expect(links.map((l) => l.platform)).toEqual(["twitter", "facebook"]);
    expect(links[0]?.href).toBe("https://twitter.com/kodigital");
    expect(links[1]?.href).toBe("https://facebook.com/kodigital");

    // links -> footer: the exact path render-pages.ts uses for every public
    // surface (renderFooter with socialLinks built from the settings map).
    const html = renderFooter({
      site: { name: "KoDigital", hostname: "kodigital.example" },
      socialLinks: buildSocialLinks(settings),
    });

    // The output IS the design `.site-footer`, and the social nav lives inside
    // it (index of each anchor is after the footer open tag).
    const footerOpen = html.indexOf('<footer class="site-footer"');
    expect(footerOpen).toBeGreaterThan(-1);
    expect(html).toContain('<nav class="site-footer__social"');
    expect(html).toContain('aria-label="Social media"');

    // rescue-4 round-2 (issue 15): footer social links are circular ICON buttons
    // (the reference shows icons, not text), each carrying an aria-label.
    const twitterAnchor =
      '<a class="site-footer__social-link" data-social="twitter" href="https://twitter.com/kodigital" target="_blank" rel="noopener noreferrer me" aria-label="Twitter">';
    const facebookAnchor =
      '<a class="site-footer__social-link" data-social="facebook" href="https://facebook.com/kodigital" target="_blank" rel="noopener noreferrer me" aria-label="Facebook">';
    expect(html).toContain(twitterAnchor);
    expect(html).toContain(facebookAnchor);
    expect(html.indexOf(twitterAnchor)).toBeGreaterThan(footerOpen);
    expect(html.indexOf(facebookAnchor)).toBeGreaterThan(footerOpen);
    // PART 8 RED LINE: no placeholder hrefs.
    expect(html).not.toContain('href="#"');
  });

  it("the footer social nav only appears once a URL is set, and unsafe schemes are dropped [api/test/social-links.test.ts]", () => {
    // No social settings -> no social nav at all (footer otherwise unchanged).
    const bare = renderFooter({
      site: { name: "KoDigital", hostname: "kodigital.example" },
      socialLinks: buildSocialLinks({}),
    });
    expect(bare).toContain('<footer class="site-footer"');
    expect(bare).not.toContain("site-footer__social");

    // A javascript:/empty value never becomes an href (stored-XSS guard).
    const unsafe = buildSocialLinks({
      social_twitter_url: "javascript:alert(1)",
      social_facebook_url: "   ",
      social_instagram_url: "https://instagram.com/kodigital",
    });
    expect(unsafe.map((l) => l.platform)).toEqual(["instagram"]);
    const unsafeHtml = renderFooter({
      site: { name: "KoDigital", hostname: "kodigital.example" },
      socialLinks: unsafe,
    });
    expect(unsafeHtml).not.toContain("javascript:");
    expect(unsafeHtml).toContain('data-social="instagram"');
  });

  it("the admin Settings form exposes the social URL fields and the PATCH allow-list accepts the keys [api/test/social-links.test.ts]", () => {
    const adminHtml = settingsPage(
      [{ id: "st_a", name: "Site A" }],
      {
        social_twitter_url: "https://twitter.com/kodigital",
        social_facebook_url: "https://facebook.com/kodigital",
      },
      "st_a",
      {},
    );
    // Each platform has an input named for its settings key, pre-filled with
    // the stored value, and the submit script lists the key so it is PATCHed.
    for (const def of SOCIAL_PLATFORMS) {
      expect(adminHtml).toContain(`name="${def.key}"`);
      expect(adminHtml).toContain(`'${def.key}'`);
      // PATCH boundary accepts the key (else the value is rejected with 400).
      expect(ALLOWED_SETTINGS_KEYS.has(def.key)).toBe(true);
    }
    expect(adminHtml).toContain('value="https://twitter.com/kodigital"');
    expect(adminHtml).toContain('value="https://facebook.com/kodigital"');

    // Visual parity: the design CSS styles the footer social nav.
    expect(publicCss).toContain(".site-footer__social");
  });
});
