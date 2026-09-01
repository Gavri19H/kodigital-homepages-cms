// OWNER 2026-09-01: "did you check the creative that is being loaded and
// compare it to the [reference] reference? your creative looks horrible" —
// then: "the [reference] project was given to you AS A REFERENCE IN THE
// CONTRACT" (the product name is a banned token in this repo, contract 00 §2,
// so it is named here only as "the reference funnel").
//
// The reference is contract 00 R1 / README: "the default funnel design is
// measured from the reference funnel", whose offer-card sheet
// (`funnel-styles-offers.ts` in the reference repo) is 175 lines: `#offersList`
// column, `.offer-card` centred flex + link resets + hover/visited/focus,
// `.offer-logo`, `.offer-content`, `.offer-name`, `.offer-description`,
// `.offer-cta` (full width), `.recommended-badge` (pill straddling the top
// edge), the winner's bigger logo + accent CTA, and a 375px arm.
//
// WHAT SHIPPED BEFORE THIS (measured from the PRODUCTION HTML of his live
// funnel, not from code): FOUR rules —
//   .lg-banner{border;border-radius;padding;background}
//   .lg-banner[data-recommended="true"]{border;background;box-shadow}
//   .lg-banner-name{font-size;font-weight;color}
//   .lg-banner-cta{background;color;border-radius;text-transform;padding;
//                  text-decoration;display}
// so the card had NO layout, the <a> kept the browser's blue underline, and
// `.lg-banners`, `.lg-banner-logo`, `.lg-banner-content`,
// `.lg-banner-headline`, `.lg-banner-subheadline`, `.lg-banner-disclaimer` and
// `.lg-banner-badge` — every one of them a region the renderer emits — had no
// rule at all. (The 17-token `bannerChromeCss` sub-sheet is NOT the live sheet:
// its `[data-banner-design=...]` scope appears 0 times in the served page.)
//
// The FIRST test below is the one that pins the whole bug class: every class
// the renderer can emit must be painted by the sheet that actually serves it.
import { describe, expect, it } from "vitest";
import { renderBanners, DEFAULT_CTA_LABEL, DEFAULT_BADGE_LABEL } from "../src/public/leadgen/auction/banner";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { bannerDefaultDesign } from "../src/public/leadgen/designs/banner-default/tokens";

// The carrier his provider actually returned for auction_instance
// 01M11ESQ5TQ36KDCXFV8746XPP (redacted copy from leadgen_provider_request_log),
// mapped through his corrected carrier_parse config. That listing shape has no
// brand field at all — only vendorKey/rank/cpc/title/description/clickurl.
const NO_BRAND_CARRIER = {
  carrier_key: "1524940",
  carrier_name: "Home insurance protects your home & belongings",
  carrier_logo: "",
  headline: "Home insurance protects your home & belongings",
  subheadline: "<ul><li>Provides financial protection for your home</li></ul>",
  click_url: "https://www.nextinsure.com/ListingDisplay/Click/?I=YWUwNGFiYjE",
  bid: 32.5,
  bid_currency: "USD",
  tracking_id: "6b8226d6-4dac-46b2-8848-254c34658bc6",
  disclaimer: "",
};

const BRANDED_CARRIER = {
  ...NO_BRAND_CARRIER,
  carrier_key: "9911",
  carrier_name: "NextInsure",
  carrier_logo: "https://cdn.example.com/logo.png",
  headline: "Bundle home + auto and save",
  subheadline: "Compare rates from top carriers in your area.",
  disclaimer: "Rates vary by state.",
  bid: 21.75,
};

type Entry = Parameters<typeof renderBanners>[0][number];

function render(carriers: readonly unknown[], bannerConfig?: unknown) {
  const entries = carriers.map((carrier, i) => ({
    carrier,
    offer_public_id: `lgo_${i}`,
    slot: i + 1,
    source: i === 0 ? "winner" : "backfill",
    bid: 10 - i,
  })) as unknown as readonly Entry[];
  return renderBanners(
    entries,
    { auction_instance_id: "01M11ESQ5TQ36KDCXFV8746XPP", funnel_attempt_id: "fa" },
    (bannerConfig ?? { mode: "automatic" }) as Parameters<typeof renderBanners>[2],
    bannerDefaultDesign,
    { mintId: () => "brid" },
  );
}

function declsOf(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.[\]="*]/g, (ch) => `\\${ch}`);
  const found = sheet.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  return found === null ? "" : (found[1] as string);
}

describe("the sheet that serves the banner paints every region the renderer emits", () => {
  it("no `lg-banner*` class reaches a visitor without a rule in the funnel sheet", () => {
    // Exercise EVERY region: a branded carrier (logo + name + headline +
    // description + disclaimer) plus the winner (badge).
    const html = render([BRANDED_CARRIER, NO_BRAND_CARRIER]).html;
    const emitted = new Set<string>();
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const cls of (m[1] as string).split(/\s+/)) {
        if (cls.startsWith("lg-banner")) emitted.add(cls);
      }
    }
    // Sanity: the render really did exercise the full anatomy.
    expect([...emitted].sort()).toEqual([
      "lg-banner",
      "lg-banner-badge",
      "lg-banner-content",
      "lg-banner-cta",
      "lg-banner-disclaimer",
      "lg-banner-headline",
      "lg-banner-logo",
      "lg-banner-name",
      "lg-banner-subheadline",
      "lg-banners",
    ]);

    const sheet = funnelChromeCss(defaultFunnelDesign);
    const unpainted = [...emitted].filter((cls) => !sheet.includes(`.${cls}`)).sort();
    expect(unpainted).toEqual([]);
  });

  it("the card resets the anchor: no blue underline, funnel text colour, centred column", () => {
    const sheet = funnelChromeCss(defaultFunnelDesign);
    const card = declsOf(sheet, ".lg-banner");
    // The card IS an <a>; without these it paints as hyperlink text.
    expect(card).toContain("text-decoration:none");
    expect(card).toContain(`color:${defaultFunnelDesign.page.textColor}`);
    // reference `.offer-card` layout.
    expect(card).toContain("display:flex");
    expect(card).toContain("flex-direction:column");
    expect(card).toContain("align-items:center");
    expect(card).toContain("text-align:center");
    // the badge straddles the card edge — it needs a positioned ancestor.
    expect(card).toContain("position:relative");
  });

  it("the badge has geometry, the CTA is full-width, the winner's CTA takes the accent", () => {
    const sheet = funnelChromeCss(defaultFunnelDesign);
    const badge = declsOf(sheet, ".lg-banner-badge");
    expect(badge).toContain("position:absolute");
    expect(badge).toContain("transform:translateX(-50%)");
    const cta = declsOf(sheet, ".lg-banner-cta");
    expect(cta).toContain("width:100%");
    expect(cta).toContain("box-sizing:border-box"); // else padding overflows the card
    // `banner.recommendedCtaBackground` had NO live reader before this fix.
    expect(sheet).toContain(
      `.lg-banner[data-recommended="true"] .lg-banner-cta{background:${defaultFunnelDesign.banner.recommendedCtaBackground}}`,
    );
  });

  it("the container is the reference's 420px centred column", () => {
    const banners = declsOf(funnelChromeCss(defaultFunnelDesign), ".lg-banners");
    expect(banners).toContain("display:flex");
    expect(banners).toContain(`max-width:${defaultFunnelDesign.cardPanel.widthM}`);
    expect(banners).toContain(`gap:${defaultFunnelDesign.spacing.md}`);
  });
});

describe("card copy: the reference's fallbacks, and never the same sentence twice", () => {
  it("a provider with no brand still gets a named card — printed ONCE", () => {
    const html = render([NO_BRAND_CARRIER]).slots[0]!.html;
    const title = "Home insurance protects your home &amp; belongings";
    // the headline takes the primary line (reference `name || displayname`) …
    expect(html).toContain(`<div class="lg-banner-name">${title}</div>`);
    // … and is NOT then repeated in its own region.
    expect(html).not.toContain(`class="lg-banner-headline"`);
    expect(html.split(title).length - 1).toBe(1);
  });

  it("a branded carrier keeps all three lines, in reference order", () => {
    const html = render([BRANDED_CARRIER]).slots[0]!.html;
    const nameAt = html.indexOf("lg-banner-name");
    const headAt = html.indexOf("lg-banner-headline");
    const subAt = html.indexOf("lg-banner-subheadline");
    expect(nameAt).toBeGreaterThan(-1);
    expect(nameAt).toBeLessThan(headAt);
    expect(headAt).toBeLessThan(subAt);
    expect(html).toContain(">NextInsure<");
    expect(html).toContain("Bundle home + auto and save");
    // the text regions live inside the reference's `.offer-content` wrapper.
    expect(html).toContain('<div class="lg-banner-content">');
  });

  it("a provider's list markup renders as bullets, not as literal tags", () => {
    const html = render([NO_BRAND_CARRIER]).slots[0]!.html;
    expect(html).toContain("<ul><li>Provides financial protection for your home</li></ul>");
    expect(html).not.toContain("&lt;ul&gt;");
    // stamped so the sheet can left-align the bullets instead of clamping them.
    expect(html).toContain('class="lg-banner-subheadline" data-rich="1"');
  });

  it("only the allowlisted subset survives — a script in a provider description cannot execute", () => {
    const nasty = {
      ...NO_BRAND_CARRIER,
      subheadline: '<script>alert(1)</script><img src=x onerror="alert(2)"><b>Safe</b>',
    };
    const html = render([nasty]).slots[0]!.html;
    expect(html).toContain("<b>Safe</b>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('onerror="alert');
    expect(html).not.toContain("<img src=x");
  });

  it("the winner gets the badge; the rest do not", () => {
    const r = render([BRANDED_CARRIER, NO_BRAND_CARRIER]);
    expect(r.slots[0]!.html).toContain(`<div class="lg-banner-badge">${DEFAULT_BADGE_LABEL}</div>`);
    expect(r.slots[1]!.html).not.toContain("lg-banner-badge");
  });

  it("CTA + badge wording default to the reference copy and are authorable in AUTOMATIC mode", () => {
    expect(DEFAULT_CTA_LABEL).toBe("VIEW MY RATE");
    expect(DEFAULT_BADGE_LABEL).toBe("BEST MATCH FOR YOU");
    const def = render([NO_BRAND_CARRIER]).slots[0]!.html;
    expect(def).toContain(`<span class="lg-banner-cta">${DEFAULT_CTA_LABEL}</span>`);

    // An automatic auction reads its card copy from banner_config_json — the
    // admin save path now persists these two fields in automatic mode too.
    const authored = render([NO_BRAND_CARRIER], {
      mode: "automatic",
      banner_config_json: { cta: "See my quote", badge: "Top pick" },
    }).slots[0]!.html;
    expect(authored).toContain('<span class="lg-banner-cta">See my quote</span>');
    expect(authored).toContain('<div class="lg-banner-badge">Top pick</div>');
  });

  it("a logo is emitted only for an absolute http(s) URL, and removes itself if it fails to load", () => {
    const ok = render([BRANDED_CARRIER]).slots[0]!.html;
    expect(ok).toContain('<img class="lg-banner-logo" src="https://cdn.example.com/logo.png"');
    expect(ok).toContain("onerror=\"this.style.display='none'\"");
    // the alt text is the card's own primary line
    expect(ok).toContain('alt="NextInsure"');

    for (const junk of ["logo.png", "//evil.example/x.png", "javascript:alert(1)", "data:image/svg+xml,x"]) {
      const html = render([{ ...BRANDED_CARRIER, carrier_logo: junk }]).slots[0]!.html;
      expect(html, junk).not.toContain("lg-banner-logo");
    }
  });
});
