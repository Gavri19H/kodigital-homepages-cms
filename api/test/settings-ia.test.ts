// T29 — Settings IA completeness (tabs).
//
// AC1 (RC-051, behavioral): the Settings UI renders all seven reference tabs
//   (General / Logo / SEO / Ads / Social / Newsletter / Advanced). Ads (ads.txt)
//   and Social (profile links) are first-class tabs of their own rather than
//   being folded into the SEO / General tabs as before.
//
// The backing it() embeds the `[api/test/settings-ia.test.ts]` file literal AND
// the `L2_AUTO_DISAMBIGUATION:T29-AC1:RC-051` binding so the D13
// parse_test_output runner binds this passing test to the required claim.
//
// The proof exercises the REAL production path: settingsPage (the served admin
// Settings markup). It asserts on the rendered HTML — a render-output proof, not
// a source grep — so an empty-shell tab (negative_fail_condition: "acceptance
// criteria pass while user-facing outcome is broken") cannot pass: each tab must
// own a real settings control.

import { describe, expect, it } from "vitest";
import { settingsPage } from "../src/admin/templates/settings";

// The full reference tab set the brief requires (in order).
const SEVEN_TABS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "general", label: "General" },
  { key: "logo", label: "Logo" },
  { key: "seo", label: "SEO" },
  { key: "ads", label: "Ads" },
  { key: "social", label: "Social" },
  { key: "newsletter", label: "Newsletter" },
  { key: "advanced", label: "Advanced" },
];

describe("T29 settings IA completeness", () => {
  const sites = [{ id: "st_a", name: "Site A" }];

  it("the Settings UI renders all seven tabs (General/Logo/SEO/Ads/Social/Newsletter/Advanced) [api/test/settings-ia.test.ts] L2_AUTO_DISAMBIGUATION:T29-AC1:RC-051", () => {
    const html = settingsPage(sites, {}, "st_a", {});

    // The tabbed layout container + tablist are present.
    expect(html).toContain('class="settings-tabs"');
    expect(html).toContain('class="settings-tablist"');

    // Each of the seven reference tabs has a tab button (correct key + label
    // wired to its panel via aria-controls) AND a matching tab panel — i.e. the
    // full reference tab set is reachable.
    for (const tab of SEVEN_TABS) {
      expect(html).toMatch(
        new RegExp(`data-tab="${tab.key}"[^>]*aria-controls="tab-${tab.key}"`),
      );
      expect(html).toContain(`>${tab.label}</button>`);
      expect(html).toContain(`id="tab-${tab.key}"`);
    }

    // Exactly seven tab buttons and seven panels — no fewer (a missing tab) and
    // no more (a spurious tab). `data-tab="` only appears once per rendered
    // button (the inline script reads it via getAttribute('data-tab')).
    const buttons = html.match(/data-tab="/g) ?? [];
    expect(buttons.length).toBe(7);
    const panels = html.match(/class="settings-tabpanel"/g) ?? [];
    expect(panels.length).toBe(7);

    // The first tab (General) is the initially-visible panel; the rest start
    // hidden — the tablist is functional, not a row of dead labels.
    expect(html).toMatch(/id="tab-general"[^>]*class="settings-tabpanel"[^>]*data-tabpanel="general"(?![^>]*hidden)/);
  });

  it("each of the seven tabs owns its settings cards (ads.txt in Ads, social links in Social) [api/test/settings-ia.test.ts]", () => {
    const html = settingsPage(sites, {}, "st_a", {});

    // A representative control for every tab — proves no tab is an empty shell.
    expect(html).toContain('name="site_name"'); // General
    expect(html).toContain('name="items_per_page"'); // General
    expect(html).toContain('id="logoFileInput"'); // Logo
    expect(html).toContain('id="brand-color-primary"'); // Logo (brand tokens)
    expect(html).toContain('name="robots_txt_content"'); // SEO
    expect(html).toContain('name="ads_txt_content"'); // Ads
    expect(html).toContain('name="social_twitter_url"'); // Social
    expect(html).toContain('id="newsletter_provider"'); // Newsletter
    expect(html).toContain('name="custom_head_html"'); // Advanced

    // The two tabs T29 promotes to first-class own their card: ads.txt lives in
    // the Ads panel and the social links in the Social panel (ordering proof —
    // the field appears after its panel opens and before the next panel).
    const adsPanel = html.indexOf('id="tab-ads"');
    const socialPanel = html.indexOf('id="tab-social"');
    const newsletterPanel = html.indexOf('id="tab-newsletter"');
    expect(adsPanel).toBeGreaterThan(-1);
    expect(socialPanel).toBeGreaterThan(adsPanel);
    expect(newsletterPanel).toBeGreaterThan(socialPanel);

    const adsField = html.indexOf('name="ads_txt_content"');
    expect(adsField).toBeGreaterThan(adsPanel);
    expect(adsField).toBeLessThan(socialPanel);

    const socialField = html.indexOf('name="social_twitter_url"');
    expect(socialField).toBeGreaterThan(socialPanel);
    expect(socialField).toBeLessThan(newsletterPanel);
  });
});
