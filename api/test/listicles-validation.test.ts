// Listicles Phase 2 — §23 validators (field-keyed errors, conditional sets,
// Σ==100 checks, exactly-one-fallback / exactly-one-control).

import { describe, expect, it } from "vitest";
import {
  validateArticle,
  validateExperiment,
  validateOffer,
  validatePage,
  validateSection,
  validateVersion,
  validateVersionFields,
} from "../src/listicles/validation";

const VALID_OFFER = {
  offer_name: "Acme Cat Food",
  provider: "acme",
  activity: "lead",
  vertical: "pets",
  conversion_tracking_method: "s2s_postback",
  offer_url_template: "https://track.acme.example/c?cid={click_id}",
  payout_method: "offsite",
};

describe("validateOffer — §23 Offer", () => {
  it("flags every missing required field, field-keyed", () => {
    const { errors, value } = validateOffer({});
    expect(value).toBeNull();
    for (const field of [
      "offer_name",
      "provider",
      "activity",
      "vertical",
      "conversion_tracking_method",
      "offer_url_template",
      "payout_method",
    ]) {
      expect(errors[field], `missing error for ${field}`).toBeTruthy();
    }
  });

  it("accepts a valid offsite offer and normalizes {clickid}", () => {
    const { errors, value } = validateOffer({
      ...VALID_OFFER,
      offer_url_template: "https://track.acme.example/c?cid={clickid}",
    });
    expect(errors).toEqual({});
    expect(value?.offer_url_template).toBe("https://track.acme.example/c?cid={click_id}");
    expect(value?.status).toBe("active");
    expect(value?.cap_enabled).toBe(0);
  });

  it("in_site ⇒ payout_currency + payout_value (conditional set)", () => {
    const missing = validateOffer({ ...VALID_OFFER, payout_method: "in_site" });
    expect(missing.value).toBeNull();
    expect(missing.errors.payout_currency).toBeTruthy();
    expect(missing.errors.payout_value).toBeTruthy();

    const ok = validateOffer({
      ...VALID_OFFER,
      payout_method: "in_site",
      payout_currency: "USD",
      payout_value: 12.5,
    });
    expect(ok.errors).toEqual({});
    expect(ok.value?.payout_value).toBe(12.5);
  });

  it("cap_enabled ⇒ cap_amount + cap_timezone + cap_count_by (conditional set)", () => {
    const missing = validateOffer({ ...VALID_OFFER, cap_enabled: true });
    expect(missing.value).toBeNull();
    expect(missing.errors.cap_amount).toBeTruthy();
    expect(missing.errors.cap_timezone).toBeTruthy();
    expect(missing.errors.cap_count_by).toBeTruthy();

    const ok = validateOffer({
      ...VALID_OFFER,
      cap_enabled: 1,
      cap_amount: 100,
      cap_timezone: "America/New_York",
      cap_count_by: "clicks",
      cap_fallback_url: "https://fallback.example.com/x",
    });
    expect(ok.errors).toEqual({});
    expect(ok.value?.cap_enabled).toBe(1);
  });

  it("rejects unknown macros in the URL template", () => {
    const { errors } = validateOffer({
      ...VALID_OFFER,
      offer_url_template: "https://track.acme.example/c?x={mystery_token}",
    });
    expect(errors.offer_url_template).toContain("{mystery_token}");
  });
});

const PARAGRAPH_BLOCK = { type: "paragraph", data: { text: "hello world" } };

describe("validateSection — §23 Section + governed links", () => {
  it("requires section_name, headline_text, and ≥1 block", () => {
    const { errors, value } = validateSection({ content_json: { blocks: [] } });
    expect(value).toBeNull();
    expect(errors.section_name).toBeTruthy();
    expect(errors.headline_text).toBeTruthy();
    expect(errors.content_json).toContain("at least one content block");
  });

  it("accepts a valid section", () => {
    const { errors, value } = validateSection({
      section_name: "Top pick",
      headline_text: "The best pick",
      content_json: { blocks: [PARAGRAPH_BLOCK] },
    });
    expect(errors).toEqual({});
    expect(value?.blocks).toHaveLength(1);
  });

  it("rejects the legacy 'affiliate' free-text-URL block", () => {
    const { errors } = validateSection({
      section_name: "s",
      headline_text: "h",
      content_json: { blocks: [{ type: "affiliate", data: { title: "x", url: "https://e.com" } }] },
    });
    expect(errors["content.blocks[0]"]).toContain("'affiliate' block is forbidden");
  });

  it("rejects any raw href anchor in block html", () => {
    const { errors } = validateSection({
      section_name: "s",
      headline_text: "h",
      content_json: {
        blocks: [{ type: "paragraph", data: { html: '<a href="https://leak.example.com">x</a>' } }],
      },
    });
    expect(errors["content.blocks[0]"]).toContain("free-text URLs are forbidden");
  });

  it("requires an offer_id on button-family blocks (a link without an Offer blocks the save)", () => {
    const { errors } = validateSection({
      section_name: "s",
      headline_text: "h",
      content_json: { blocks: [{ type: "button", data: { text: "Get quote" } }] },
    });
    expect(errors["content.blocks[0]"]).toContain("must reference an Offer");
  });
});

describe("validateArticle — §23 Article base", () => {
  it("requires site_id + article_name + slug", () => {
    const { errors, value } = validateArticle({});
    expect(value).toBeNull();
    expect(errors.site_id).toBeTruthy();
    expect(errors.article_name).toBeTruthy();
    expect(errors.slug).toBeTruthy();
  });

  it("rejects malformed slugs", () => {
    expect(
      validateArticle({ site_id: "st1", article_name: "n", slug: "Bad Slug!" }).errors.slug,
    ).toBeTruthy();
    expect(
      validateArticle({ site_id: "st1", article_name: "n", slug: "good-slug-9" }).errors,
    ).toEqual({});
  });
});

const VALID_VERSION_FIELDS = {
  headline: "Big headline",
  intro_paragraph: "Intro",
  hero_media_url: "https://cdn.example.com/hero.jpg",
  layout_style_id: "default",
};

describe("validateVersionFields / validateVersion — §23 Version", () => {
  it("requires headline, intro_paragraph, hero, layout_style_id", () => {
    const { errors, value } = validateVersionFields({});
    expect(value).toBeNull();
    expect(errors.headline).toBeTruthy();
    expect(errors.intro_paragraph).toBeTruthy();
    expect(errors.hero).toBeTruthy();
    expect(errors.layout_style_id).toBeTruthy();
  });

  it("a full Version needs ≥1 Page, each with ≥1 candidate", () => {
    const noPages = validateVersion({ ...VALID_VERSION_FIELDS, pages: [] });
    expect(noPages.errors.pages).toBeTruthy();

    const emptyPage = validateVersion({
      ...VALID_VERSION_FIELDS,
      pages: [{ selection_mode: "single", candidates: [] }],
    });
    expect(emptyPage.errors["page_0.candidates"]).toContain("at least one Section candidate");
  });

  it("accepts a valid single-page version", () => {
    const result = validateVersion({
      ...VALID_VERSION_FIELDS,
      pages: [{ selection_mode: "single", candidates: [{ section_id: 1 }] }],
    });
    expect(result.errors).toEqual({});
    expect(result.pages).toHaveLength(1);
  });
});

describe("validatePage — mode invariants (§15.8/§23)", () => {
  it("ab_test allocations must total exactly 100", () => {
    const bad = validatePage(
      {
        selection_mode: "ab_test",
        candidates: [
          { section_id: 1, traffic_allocation: 50 },
          { section_id: 2, traffic_allocation: 40 },
        ],
      },
      3,
    );
    expect(bad.errors["page_3.traffic_allocation"]).toContain("total 100");

    const ok = validatePage(
      {
        selection_mode: "ab_test",
        candidates: [
          { section_id: 1, traffic_allocation: 60 },
          { section_id: 2, traffic_allocation: 40 },
        ],
      },
      3,
    );
    expect(ok.errors).toEqual({});
  });

  it("every ab_test candidate needs an allocation", () => {
    const { errors } = validatePage(
      { selection_mode: "ab_test", candidates: [{ section_id: 1 }, { section_id: 2, traffic_allocation: 100 }] },
      0,
    );
    expect(errors["page_0.candidates[0].traffic_allocation"]).toBeTruthy();
  });

  it("rule_based requires exactly one fallback", () => {
    const none = validatePage(
      {
        selection_mode: "rule_based",
        candidates: [
          { section_id: 1, rule: { priority: 1, conditions: { sets: { country: ["US"] } } } },
        ],
      },
      1,
    );
    expect(none.errors["page_1.fallback"]).toContain("exactly one fallback");

    const two = validatePage(
      {
        selection_mode: "rule_based",
        candidates: [
          { section_id: 1, is_fallback: true },
          { section_id: 2, is_fallback: true },
        ],
      },
      1,
    );
    expect(two.errors["page_1.fallback"]).toContain("got 2");
  });

  it("each non-fallback rule_based candidate needs a rule", () => {
    const { errors } = validatePage(
      {
        selection_mode: "rule_based",
        candidates: [{ section_id: 1 }, { section_id: 2, is_fallback: true }],
      },
      0,
    );
    expect(errors["page_0.candidates[0].rule"]).toBeTruthy();
  });

  it("a 'single' page carries exactly one candidate", () => {
    const { errors } = validatePage(
      { selection_mode: "single", candidates: [{ section_id: 1 }, { section_id: 2 }] },
      0,
    );
    expect(errors["page_0.candidates"]).toContain("exactly one");
  });
});

describe("validateExperiment — §23 Article A/B", () => {
  it("Σ allocations must equal 100", () => {
    const { errors } = validateExperiment({
      name: "exp",
      versions: [
        { version_id: 1, traffic_allocation: 50, is_control: true },
        { version_id: 2, traffic_allocation: 40 },
      ],
    });
    expect(errors.traffic_allocation).toContain("got 90");
  });

  it("exactly one control is required", () => {
    const none = validateExperiment({
      name: "exp",
      versions: [
        { version_id: 1, traffic_allocation: 50 },
        { version_id: 2, traffic_allocation: 50 },
      ],
    });
    expect(none.errors.is_control).toContain("got 0");

    const two = validateExperiment({
      name: "exp",
      versions: [
        { version_id: 1, traffic_allocation: 50, is_control: true },
        { version_id: 2, traffic_allocation: 50, is_control: 1 },
      ],
    });
    expect(two.errors.is_control).toContain("got 2");
  });

  it("a new-version arm must carry the §23 Version fields", () => {
    const { errors } = validateExperiment({
      name: "exp",
      versions: [
        { version_id: 1, traffic_allocation: 50, is_control: true },
        { traffic_allocation: 50 }, // neither version_id nor fields
      ],
    });
    expect(errors["versions[1].headline"]).toBeTruthy();
  });

  it("accepts a valid 50/50 experiment", () => {
    const { errors, value } = validateExperiment({
      name: "Headline test",
      versions: [
        { version_id: 1, traffic_allocation: 50, is_control: true },
        { version_id: "ver_01ABCDEFGHJKMNPQRSTVWXYZ01", traffic_allocation: 50 },
      ],
    });
    expect(errors).toEqual({});
    expect(value?.versions).toHaveLength(2);
  });
});
