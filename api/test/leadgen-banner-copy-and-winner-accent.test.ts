// OWNER 2026-09-28 — three results-card bugs on the "Home Insurance | Match"
// funnel (screenshots in the evidence folder):
//   1. "The first and third banners show `*50%*` with literal asterisks
//      instead of the intended bold formatting."
//   2. "The Progressive banner displays `Renter&#39;s` instead of `Renter's`."
//   3. "Both the first banner's 'VIEW MY RATE' button and its highlighted
//      border appear washed out … a solid orange button with readable white
//      text and a clearly visible orange border around the recommended offer."
//
// The card copy below is the REAL provider copy the funnel rendered (prod
// leadgen_provider_request_log row 376, parsed_carriers_json; only click_url
// and tracking_id replaced), and the theme is that funnel's REAL theme_json
// (prod leadgen_funnels id 12) — its accent is the pale peach #fce7de, which is
// what the winner card's button and border were painted with.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderBanners } from "../src/public/leadgen/auction/banner";
import type { BannerRenderCarrier } from "../src/public/leadgen/auction/banner";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { getBannerDesign } from "../src/public/leadgen/designs/registry";
import { resolveTokens, winnerCardAccentVerdict, WINNER_CARD_MIN_CONTRAST } from "../src/public/leadgen/designs/theme";
import type { ThemeJson } from "../src/public/leadgen/designs/theme";
import { computedStyle, parseDom, rulesFor } from "./helpers/leadgen-visible-paint";

const PROD_CARRIERS = (
  JSON.parse(readFileSync(new URL("./fixtures/banner-copy/prod-row-376-carriers.json", import.meta.url), "utf8")) as {
    carriers: LeadgenParsedCarrier[];
  }
).carriers;
const PROD_THEME = JSON.parse(
  readFileSync(new URL("./fixtures/banner-copy/prod-funnel-12-theme.json", import.meta.url), "utf8"),
) as ThemeJson;

function render(carriers: readonly LeadgenParsedCarrier[]) {
  const entries: BannerRenderCarrier[] = carriers.map((carrier, i) => ({
    carrier,
    offer_public_id: "lgo_01KZR5XF3MHPHPX8PF9ADK9CZ9",
    slot: i + 1,
    source: "winner",
    bid: 1 - i / 10,
  }));
  return renderBanners(entries, { auction_instance_id: "ai", funnel_attempt_id: "fa" }, { mode: "automatic" }, getBannerDesign(null), {
    mintId: () => "brid",
  });
}

function carrier(over: Partial<LeadgenParsedCarrier>): LeadgenParsedCarrier {
  return { ...PROD_CARRIERS[0]!, carrier_logo: "", subheadline: null, ...over };
}

// The inner HTML of one region of one card.
function regionHtml(cardHtml: string, klass: string): string {
  const m = new RegExp(`<div class="${klass}"(?: data-rich="1")?>(.*?)</div>`).exec(cardHtml);
  if (m === null) throw new Error(`no .${klass} in ${cardHtml}`);
  return m[1]!;
}

// What a visitor reads: tags dropped, then the five escapes esc()/escapeText
// emit decoded — exactly one browser text decode.
function visible(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("OWNER 2026-09-28 bug 2 — encoded provider copy is decoded before it is shown", () => {
  it("the real Progressive headline reads Renter's, not Renter&#39;s", () => {
    const card = render(PROD_CARRIERS).slots[1]!.html;
    expect(visible(regionHtml(card, "lg-banner-headline"))).toBe("Renter's Insurance Protects You & Your Belongings");
    expect(card).not.toContain("&amp;#39;");
  });

  it("every HTML 4 named entity decodes (accents, punctuation, spacing marks); an unknown name stays as written", () => {
    const html = render([carrier({ carrier_name: "Farmers&reg;", headline: "Save &ndash; fast&hellip; &constructor;" })]).slots[0]!.html;
    expect(visible(regionHtml(html, "lg-banner-name"))).toBe("Farmers\u00AE");
    expect(visible(regionHtml(html, "lg-banner-headline"))).toBe("Save \u2013 fast\u2026 &constructor;");
    const latin = render([
      carrier({ headline: "Caf&eacute; Espa&ntilde;ol M&uuml;ller &iquest;Qu&eacute;? &iexcl;S&iacute;! &Eacute;" }),
    ]).slots[0]!.html;
    expect(visible(regionHtml(latin, "lg-banner-headline"))).toBe("Caf\u00E9 Espa\u00F1ol M\u00FCller \u00BFQu\u00E9? \u00A1S\u00ED! \u00C9");
    const marks = render([carrier({ headline: "a&ensp;b&emsp;c&thinsp;d&lrm;e&shy;f&zwj;g" })]).slots[0]!.html;
    expect(visible(regionHtml(marks, "lg-banner-headline"))).toBe("a\u2002b\u2003c\u2009d\u200Ee\u00ADf\u200Dg");
    // a name that is an Object.prototype key never reads the prototype
    const proto = render([carrier({ headline: "&toString; &__proto__; &hasOwnProperty;" })]).slots[0]!.html;
    expect(visible(regionHtml(proto, "lg-banner-headline"))).toBe("&toString; &__proto__; &hasOwnProperty;");
  });

  it("decoding never lets encoded markup through: it is escaped again and reads as text", () => {
    const html = render([carrier({ headline: "&lt;img src=x onerror=alert(1)&gt; &quot;hi&quot;" })]).slots[0]!.html;
    expect(html).not.toMatch(/<img src=x/i);
    expect(regionHtml(html, "lg-banner-headline")).toBe("&lt;img src=x onerror=alert(1)&gt; &quot;hi&quot;");
    expect(visible(regionHtml(html, "lg-banner-headline"))).toBe('<img src=x onerror=alert(1)> "hi"');
  });

  it("double-encoded copy reads the same in the headline as in the description", () => {
    const html = render([carrier({ headline: "Renter&amp;#39;s cover", subheadline: "<p>Renter&amp;#39;s cover too</p>" })]).slots[0]!.html;
    expect(visible(regionHtml(html, "lg-banner-headline"))).toBe("Renter's cover");
    expect(visible(regionHtml(html, "lg-banner-subheadline"))).toBe("Renter's cover too");
  });

  it("the logo's alt text is the decoded, marker-free name", () => {
    const html = render([carrier({ carrier_name: "Renter&#39;s *Best*", carrier_logo: "https://cdn.example.com/l.png" })]).slots[0]!.html;
    expect(html).toContain(`alt="Renter&#39;s Best"`);
  });
});

describe("OWNER 2026-09-28 bug 1 — *text* renders bold, markers hidden", () => {
  it("the real first and third headlines bold 50% and print no asterisk", () => {
    const slots = render(PROD_CARRIERS).slots;
    const first = regionHtml(slots[0]!.html, "lg-banner-headline");
    const third = regionHtml(slots[2]!.html, "lg-banner-headline");
    expect(first).toBe("Home Insurance in California: Save up to <strong>50%</strong>");
    expect(third).toBe("California: Save up to <strong>50%</strong> on Your Home Insurance!");
    expect(visible(first)).not.toContain("*");
    expect(visible(third)).not.toContain("*");
  });

  it("**text** and ***text*** are bold too, with no star left over", () => {
    const headline = (h: string): string => regionHtml(render([carrier({ headline: h })]).slots[0]!.html, "lg-banner-headline");
    expect(headline("Get **Free** quotes")).toBe("Get <strong>Free</strong> quotes");
    expect(headline("Save ***50%*** today")).toBe("Save <strong>50%</strong> today");
    expect(headline('Say "*Free*" (*now*)!')).toBe("Say &quot;<strong>Free</strong>&quot; (<strong>now</strong>)!");
  });

  it("stars that are not a marker pair stay literal: footnotes, maths, a mismatched pair", () => {
    const headline = (h: string): string => regionHtml(render([carrier({ headline: h })]).slots[0]!.html, "lg-banner-headline");
    for (const literal of [
      "Save 50%* on rates. *Terms apply",
      "Save 15%*, compare 20+ carriers*!",
      "Save **50% today*",
      "2*3*4 and M*A*S*H",
      "rated 5 * 4 * 3",
    ]) {
      expect(headline(literal)).toBe(literal);
    }
  });

  it("in a rich description the markers bold list text but never touch a tag or its attribute", () => {
    const html = render([
      carrier({ subheadline: '<ul><li>*Free* quotes</li><li><a href="https://x.example/*a*">see *all*</a></li><li>Fast &amp; *easy* &lt;b&gt;</li></ul>' }),
    ]).slots[0]!.html;
    const sub = regionHtml(html, "lg-banner-subheadline");
    expect(sub).toBe(
      '<ul><li><strong>Free</strong> quotes</li><li><a href="https://x.example/*a*">see <strong>all</strong></a></li>' +
        "<li>Fast &amp; <strong>easy</strong> &lt;b&gt;</li></ul>",
    );
  });

  it("markers inside encoded markup stay text: the bold is real <strong>, the payload is escaped", () => {
    const html = render([carrier({ headline: "*&lt;b onclick=x&gt;*" })]).slots[0]!.html;
    expect(regionHtml(html, "lg-banner-headline")).toBe("<strong>&lt;b onclick=x&gt;</strong>");
  });
});

describe("OWNER 2026-09-28 bug 3 — the winner card stays a solid orange button with a visible orange border", () => {
  const SCOPE = DEFAULT_FUNNEL_SCOPE;

  function winnerPaint(theme: ThemeJson): { cta: string | undefined; border: string | undefined; design: typeof defaultFunnelDesign } {
    const tokens = resolveTokens(defaultFunnelDesign, theme, null, null);
    const design = tokens.design as typeof defaultFunnelDesign;
    const css = funnelChromeCss(design, SCOPE, { frameRegions: true });
    const els = parseDom(`<div data-funnel-design="default-funnel">${render(PROD_CARRIERS).html}</div>`);
    const rules = rulesFor(css, "desktop");
    const card = els.find((el) => el.classes.has("lg-banner") && el.attrs.get("data-recommended") === "true");
    if (card === undefined) throw new Error("the real render has no winner card");
    const cta = els.find((el) => el.classes.has("lg-banner-cta") && el.ancestors.includes(card.index));
    if (cta === undefined) throw new Error("the winner card has no CTA");
    return {
      cta: computedStyle(rules, cta, els).get("background")?.value,
      border: computedStyle(rules, card, els).get("border")?.value,
      design,
    };
  }

  it("the funnel's real theme (accent #fce7de) paints the winner's button and border the design's orange", () => {
    const painted = winnerPaint(PROD_THEME);
    expect(painted.cta).toBe("#E85D26");
    expect(painted.border).toBe("2px solid #E85D26");
    // the button text is the white the owner asked for
    expect(painted.design.banner.ctaColor).toBe("#FFFFFF");
    // the accent still reaches the surfaces it can carry
    expect(painted.design.categoryLabel.color).toBe("#fce7de");
    expect(painted.design.header.logoAccentColor).toBe("#fce7de");
  });

  it("an accent white text is readable on still themes the winner card", () => {
    const painted = winnerPaint({ palette: { accent: "#123456" } });
    expect(painted.cta).toBe("#123456");
    expect(painted.border).toBe("2px solid #123456");
  });

  it(`the line is ${WINNER_CARD_MIN_CONTRAST}:1 against the button text; the design's own orange clears it`, () => {
    const card = defaultFunnelDesign.banner.recommendedBg;
    expect(winnerCardAccentVerdict("#fce7de", "#FFFFFF", card)).toEqual({ readable: false, ratio: 1.19 });
    expect(winnerCardAccentVerdict("#E85D26", "#FFFFFF", card)).toEqual({ readable: true, ratio: 3.49 });
    expect(winnerCardAccentVerdict("#E85D26FF", "#FFFFFF", card)).toEqual({ readable: true, ratio: 3.49 });
    // unmeasurable (not a hex literal) → the operator's accent is honoured
    expect(winnerCardAccentVerdict("rgb(1,2,3)", "#FFFFFF", card)).toEqual({ readable: true, ratio: null });
  });

  it("a translucent accent is measured as it paints over the card: a 20% or 0% orange is pale, not orange", () => {
    const card = defaultFunnelDesign.banner.recommendedBg;
    expect(winnerCardAccentVerdict("#E85D2633", "#FFFFFF", card).readable).toBe(false);
    expect(winnerCardAccentVerdict("#E85D2600", "#FFFFFF", card)).toEqual({ readable: false, ratio: 1.04 });
    expect(winnerCardAccentVerdict("#F803", "#FFFFFF", card).readable).toBe(false);
    for (const accent of ["#E85D2633", "#E85D2600"]) {
      const painted = winnerPaint({ palette: { accent } });
      expect(painted.cta).toBe("#E85D26");
      expect(painted.border).toBe("2px solid #E85D26");
    }
  });
});
