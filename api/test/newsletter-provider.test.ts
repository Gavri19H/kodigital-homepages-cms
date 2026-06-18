// T26 — Newsletter: real per-provider integration.
//
// AC1 (RC-046, behavioral): picking a provider + its list/key field makes the
//   public form post to that provider's REAL hosted-form action; switching the
//   provider changes the form action. The admin card reveals the selected
//   provider's connection field.
// AC2 (RC-047, behavioral): the newsletter card renders `.newsletter` as the
//   design-contract two-column card (1fr 1fr) with a brand-soft border on a
//   brand-tint background.
//
// Each backing it() embeds the `[api/test/newsletter-provider.test.ts]` file
// literal AND the `L2_AUTO_DISAMBIGUATION:T<id>-AC<n>:RC-<nnn>` binding so the
// D13 parse_test_output runner binds the passing test to the required claim.

import { describe, expect, it } from "vitest";
import {
  buildNewsletterForm,
  renderNewsletter,
} from "../src/public/templates/components";
import { publicCss } from "../src/public/assets/public-css";
import { settingsPage } from "../src/admin/templates/settings";

// Extract one selector's declaration block so a value matched in an unrelated
// rule can never satisfy the assertion (mirrors design-contract-values.test).
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`);
  const match = publicCss.match(re);
  expect(match, `publicCss has a rule for selector "${selector}"`).not.toBeNull();
  return match === null ? "" : (match[1] ?? "");
}

describe("T26 newsletter per-provider integration", () => {
  it("picking Mailchimp + a list id posts to Mailchimp's real action and switching provider changes the action [api/test/newsletter-provider.test.ts] L2_AUTO_DISAMBIGUATION:T26-AC1:RC-046", () => {
    // Mailchimp embedded-form action is built from server + account (u) + list id.
    const mailchimp = buildNewsletterForm("mailchimp", {
      server: "us1",
      account: "abc",
      list_id: "123",
    });
    expect(mailchimp).not.toBeNull();
    expect(mailchimp?.action).toBe(
      "https://us1.list-manage.com/subscribe/post?u=abc&id=123",
    );
    expect(mailchimp?.emailField).toBe("EMAIL");

    // Switching the provider changes the embed/action entirely.
    const convertkit = buildNewsletterForm("convertkit", { form_id: "999" });
    expect(convertkit).not.toBeNull();
    expect(convertkit?.action).toBe(
      "https://app.convertkit.com/forms/999/subscriptions",
    );
    expect(convertkit?.emailField).toBe("email_address");
    expect(convertkit?.action).not.toBe(mailchimp?.action);

    // Missing required config => no provider form (caller falls back), so an
    // incomplete selection is never silently treated as a real provider action.
    expect(buildNewsletterForm("mailchimp", { list_id: "123" })).toBeNull();
    // Custom provider only accepts an https action (L-041 scheme guard).
    expect(buildNewsletterForm("custom", { action: "javascript:alert(1)" })).toBeNull();

    // The PUBLIC form posts to the provider's real action (attribute-escaped).
    const mcHtml = renderNewsletter({
      heading: "Subscribe",
      provider: "mailchimp",
      config: { server: "us1", account: "abc", list_id: "123" },
    });
    expect(mcHtml).toContain(
      'action="https://us1.list-manage.com/subscribe/post?u=abc&amp;id=123"',
    );
    expect(mcHtml).toContain('name="EMAIL"');
    expect(mcHtml).not.toContain("/api/newsletter/subscribe");

    // Switching the provider on the public form changes the action.
    const ckHtml = renderNewsletter({
      heading: "Subscribe",
      provider: "convertkit",
      config: { form_id: "999" },
    });
    expect(ckHtml).toContain('action="https://app.convertkit.com/forms/999/subscriptions"');
    expect(ckHtml).toContain('name="email_address"');
    expect(ckHtml).not.toContain("list-manage.com");

    // The admin card reveals the selected provider's connection field and the
    // submit script composes those values into newsletter_settings_json.config.
    const adminHtml = settingsPage(
      [{ id: "st_a", name: "Site A" }],
      {
        newsletter_settings_json:
          '{"enabled":true,"provider":"mailchimp","config":{"server":"us1","account":"abc","list_id":"123"}}',
      },
      "st_a",
      {},
    );
    expect(adminHtml).toContain('data-newsletter-provider="mailchimp"');
    expect(adminHtml).toContain('data-newsletter-cfg-key="list_id"');
    expect(adminHtml).toContain('value="123"');
    expect(adminHtml).toContain("data-newsletter-cfg-key");
    expect(adminHtml).toContain("config: nlConfig");
  });

  it("renders .newsletter as the design-contract two-column card with brand-soft border on a brand-tint background [api/test/newsletter-provider.test.ts] L2_AUTO_DISAMBIGUATION:T26-AC2:RC-047", () => {
    const decl = declarations(".newsletter");
    // Two-column card (design-contract §4/§10: `1fr 1fr`).
    expect(decl).toContain("grid-template-columns: 1fr 1fr");
    // Brand-soft border + brand-tint background + radius-lg.
    expect(decl).toContain("border: 1px solid var(--tw-brand-soft)");
    expect(decl).toContain("background: var(--tw-brand-tint)");
    expect(decl).toContain("border-radius: var(--tw-radius-lg)");

    // Stacks to one column at the 760px breakpoint.
    const idx760 = publicCss.indexOf("@media (max-width:760px)");
    expect(idx760).toBeGreaterThan(-1);
    expect(
      publicCss.indexOf(".newsletter { grid-template-columns: 1fr; }"),
    ).toBeGreaterThan(idx760);

    // The rendered section carries the .newsletter root selector.
    const html = renderNewsletter({ heading: "Stay in the loop", provider: null });
    expect(html).toContain('class="newsletter"');
  });
});
