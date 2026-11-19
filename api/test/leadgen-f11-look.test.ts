// F11 — the redirect screen's look and markup (plan Section 3 D/G/H, Section 4,
// Section 8 "Templates → L · Redirect" and "Visitor, both looks").
//
// What this file proves, through the REAL producers (no hand-built expected
// markup on the "real" side):
//   1. "L · Redirect" save checks (designs/frames.ts validateFrameConfig): every
//      value is accepted; bad values are refused with a plain message.
//   2. A Template with nothing set shows the Theme defaults (plan Section 4's
//      table), on two Themes (a moneylantern-like base and an insurissimo-like
//      inline theme), including through loadRedirectLook's real composition.
//   3. The banner shows only the chosen card (marked, link unchanged), the
//      brand and no-brand countdown lines, escaped operator text; with backfill
//      (two renders) the card is found by its render id + slot.
//   4. The animation-only screen shows no card.
//   5. Each of the five animations is timed to the rule's seconds and stands
//      still under "Reduce motion".
//   6. Every "L · Redirect" key changes the rendered screen (the liveness the
//      dead-controls sweep delegates here for the results-page element).
//   7. The screen never uses the attribute names the visitor bundle's
//      viewability lookup keys on, so the chosen card is what gets its view.

import { describe, expect, it } from "vitest";
import { renderBanners, type BannerRenderCarrier } from "../src/public/leadgen/auction/banner";
import { getBannerDesign, getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { validateFrameConfig, FRAME_REDIRECT_ANIMATIONS, FRAME_SIZES, FRAME_REDIRECT_CORNERS } from "../src/public/leadgen/designs/frames";
import type { FrameRedirectConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens, type ThemeJson } from "../src/public/leadgen/designs/theme";
import { REDIRECT_LOOK_DEFAULTS, resolveRedirectLook } from "../src/public/leadgen/redirect/look";
import {
  loadRedirectLook,
  markChosenCard,
  REDIRECT_SCREEN_CSS,
  renderRedirectScreen,
  type ResolvedFunnelForRedirect,
} from "../src/public/leadgen/redirect/screen";
import { COUNTDOWN_ANIMATION_CSS, renderCountdownAnimation } from "../src/public/leadgen/redirect/animations";
import type { RedirectAfterInstruction } from "../src/public/leadgen/redirect/types";
import { miniDocument } from "./helpers/mini-dom";

// ---------------------------------------------------------------------------
// Fixtures: real cards from the real card renderer.
// ---------------------------------------------------------------------------

function entry(key: string, name: string | null, slot: number, offer: string, logo = true): BannerRenderCarrier {
  return {
    carrier: {
      carrier_key: key,
      carrier_name: name,
      carrier_logo: logo ? `https://cdn.example.com/${key}.png` : null,
      headline: `Headline ${key}`,
      subheadline: "Sub line",
      click_url: `https://partner.example.com/${key}`,
      bid: 2,
      bid_currency: "USD",
      tracking_id: null,
      disclaimer: null,
      pricing_model: null,
      carrier_key_source: "provider_id",
    },
    offer_public_id: offer,
    slot,
    source: slot === 1 ? "winner" : "multi_offer",
    bid: 2,
  };
}

function cards(brid = "BRID1", entries?: BannerRenderCarrier[]): string {
  return renderBanners(
    entries ?? [entry("alpha", "Alpha Co", 1, "lgo_alpha"), entry("beta", "Beta Co", 2, "lgo_beta"), entry("gamma", "Gamma Co", 3, "lgo_gamma")],
    { auction_instance_id: "ai_1", funnel_attempt_id: "fa_1" },
    { mode: "automatic" },
    getBannerDesign(null),
    { mintId: () => brid },
  ).html;
}

function instruction(over: Partial<RedirectAfterInstruction> = {}): RedirectAfterInstruction {
  return {
    rule_public_id: "lfr_1",
    offer_public_id: "lgo_beta",
    slot: 2,
    carrier_key: "beta",
    seconds: 5,
    display: "banner",
    brand: "Beta Co",
    logo_url: "https://cdn.example.com/beta.png",
    stay_hides: { mode: "offer", offer_public_id: "lgo_beta" },
    banner_render_id: "BRID1",
    ...over,
  };
}

const BASE = getFunnelDesign(null);
const MONEYLANTERN_LIKE = resolveTokens(BASE, {} as ThemeJson, null, null).design;
const INSURISSIMO_THEME: ThemeJson = {
  palette: {
    brand_primary: "#0B6E4F",
    surface_wash: "#E3F4EC",
    border: "#C9DDD3",
    card_background: "#FBFFFD",
    text_primary: "#14213D",
    text_muted: "#4F5D75",
  },
  typography: { display: "poppins", body: "manrope" },
  scales: { radius: "round" },
};
const INSURISSIMO_LIKE = resolveTokens(BASE, INSURISSIMO_THEME, null, null).design;

function screen(over: Partial<RedirectAfterInstruction> = {}, stored: unknown = null, html = cards()): string {
  return renderRedirectScreen({ banners_html: html, instruction: instruction(over), look: resolveRedirectLook(stored, MONEYLANTERN_LIKE) });
}

// ===========================================================================
// 1 · save checks
// ===========================================================================

const EVERY_VALUE: Required<{ [K in keyof FrameRedirectConfig]: NonNullable<FrameRedirectConfig[K]> }> = {
  badge_on: false,
  badge_text: "Matched for {brand}",
  headline: "Good news",
  message_on: false,
  message: "{brand} is ready for you.",
  countdown_line: "Opening {brand} in {n}…",
  stay_label: "Not now",
  background_role: "surface_wash",
  border_role: "brand_primary",
  badge_role: "accent",
  badge_bg_role: "page_background",
  headline_role: "brand_primary",
  text_role: "text_primary",
  corners: "rounded",
  shadow: false,
  headline_size: "l",
  animation: "dots",
  animation_role: "accent",
  track_role: "surface_wash",
  animation_size: "s",
  show_seconds: false,
  only_headline: "Off to {brand}",
  only_message: "One moment, {n} seconds.",
  only_link: "See every offer",
};

function problemsOf(redirect: unknown): string[] {
  return validateFrameConfig({ version: 1, redirect }).problems.filter((p) => p.severity === "error").map((p) => `${p.path}: ${p.message}`);
}

describe("F11 · L · Redirect — save checks (closed values, plain texts, {n} in the countdown line)", () => {
  it("accepts every setting at a non-default value, and null (= the default) for every one", () => {
    expect(problemsOf(EVERY_VALUE)).toEqual([]);
    const allNull = Object.fromEntries(Object.keys(EVERY_VALUE).map((k) => [k, null]));
    expect(problemsOf(allNull)).toEqual([]);
    expect(problemsOf(null), "the whole block null = the Theme look").toEqual([]);
    // every closed vocabulary, every member
    for (const a of FRAME_REDIRECT_ANIMATIONS) expect(problemsOf({ animation: a })).toEqual([]);
    for (const c of FRAME_REDIRECT_CORNERS) expect(problemsOf({ corners: c })).toEqual([]);
    for (const s of FRAME_SIZES) expect(problemsOf({ headline_size: s, animation_size: s })).toEqual([]);
  });

  it("refuses bad values with a plain message, path by path", () => {
    const cases: Array<[unknown, string, RegExp]> = [
      [{ countdown_line: "Taking you to {brand} soon" }, "frame.redirect.countdown_line", /must include \{n\}/],
      [{ headline: "x".repeat(121) }, "frame.redirect.headline", /at most 120 characters \(it has 121\)/],
      [{ message: "Hi {name}" }, "frame.redirect.message", /only use the fill-ins \{brand\} and \{n\} — \{name\}/],
      [{ badge_text: "<b>Match</b>" }, "frame.redirect.badge_text", /plain text/],
      [{ stay_label: "Stay\nhere" }, "frame.redirect.stay_label", /plain text/],
      [{ only_link: 42 }, "frame.redirect.only_link", /plain text, or empty/],
      [{ animation: "confetti" }, "frame.redirect.animation", /Countdown ring, Progress bar, Logo on a bar, Spinner, Dots/],
      [{ corners: "pill" }, "frame.redirect.corners", /Follow the Theme, Square, Rounded/],
      [{ headline_size: "xl" }, "frame.redirect.headline_size", /Small, Medium, Large/],
      [{ background_role: "#ff0000" }, "frame.redirect.background_role", /theme colour role/],
      [{ shadow: "yes" }, "frame.redirect.shadow", /on or off/],
      [{ sparkle: true }, "frame.redirect.sparkle", /isn't a recognised redirect setting/],
      ["banner", "frame.redirect", /group of settings/],
    ];
    for (const [value, path, message] of cases) {
      const got = problemsOf(value);
      expect(got.length, `${JSON.stringify(value)} is refused`).toBeGreaterThan(0);
      expect(got.some((g) => g.startsWith(`${path}: `) && message.test(g)), `${JSON.stringify(value)} → ${got.join(" | ")}`).toBe(true);
    }
    // exactly 120 characters is fine
    expect(problemsOf({ headline: "x".repeat(120) })).toEqual([]);
  });
});

// ===========================================================================
// 2 · Theme defaults on two Themes
// ===========================================================================

describe("F11 · a Template with nothing set shows the Theme defaults (plan Section 4)", () => {
  it("moneylantern-like: navy and white, 14px corners, the Theme's large shadow and fonts", () => {
    const look = resolveRedirectLook(null, MONEYLANTERN_LIKE);
    expect(look.css).toEqual({
      background: "#FFFFFF",
      border: "#D2D9E5",
      badge: "#1B3A5C",
      badge_bg: "#E8EEF4",
      headline: "#1A1F36",
      text: "#4A5568",
      animation: "#1B3A5C",
      track: "#D2D9E5",
      radius: "14px",
      shadow: MONEYLANTERN_LIKE.shadow.lg,
      font_headline: MONEYLANTERN_LIKE.headline.fontFamily,
      font_body: MONEYLANTERN_LIKE.page.fontFamily,
    });
    expect(look.texts).toEqual({
      badge_text: "It’s a match",
      headline: "We found an offer that fits you",
      message: "{brand} will help you finish in a few steps.",
      countdown_line: "Taking you to {brand} in {n}…",
      stay_label: "Stay here",
      only_headline: "Taking you to {brand}…",
      only_message: "You’ll continue on our partner’s site in a few seconds.",
      only_link: "Show me all offers",
    });
    expect([look.badge_on, look.message_on, look.shadow, look.show_seconds]).toEqual([true, true, true, true]);
    expect([look.animation, look.animation_size, look.headline_size, look.corners]).toEqual(["ring", "m", "m", "theme"]);
  });

  it("insurissimo-like: the SAME empty Template takes that Theme's own colours, corners and fonts — no setup", () => {
    const look = resolveRedirectLook(null, INSURISSIMO_LIKE);
    expect(look.css.background).toBe("#FBFFFD");
    expect(look.css.border).toBe("#C9DDD3");
    expect(look.css.badge).toBe("#0B6E4F");
    expect(look.css.badge_bg).toBe("#E3F4EC");
    expect(look.css.headline).toBe("#14213D");
    expect(look.css.text).toBe("#4F5D75");
    expect(look.css.animation).toBe("#0B6E4F");
    expect(look.css.radius).toBe(INSURISSIMO_LIKE.radius.lg);
    expect(look.css.radius).not.toBe("14px"); // "round" moves the Theme's corners
    expect(look.css.font_headline).toContain("Poppins");
    expect(look.css.font_body).toContain("Manrope");
    // ...and the rendered screen carries them.
    const html = renderRedirectScreen({ banners_html: cards(), instruction: instruction(), look });
    expect(html).toContain("--lg-rd-badge:#0B6E4F;--lg-rd-badge-bg:#E3F4EC");
    expect(html).toContain("'Poppins'");
  });

  it("loadRedirectLook: the funnel's REAL composition — an empty Template reads the Theme, a saved block wins, a bad env is null", async () => {
    const env = {
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
      CACHE: { get: async () => null },
    };
    const resolved = (frame: unknown, theme: unknown): ResolvedFunnelForRedirect =>
      ({
        quote: { public_id: "lgq_1" },
        funnel: { frame_config_json: frame === null ? null : JSON.stringify(frame), theme_json: theme === null ? null : JSON.stringify(theme), frame_template_id: null },
        variant: { frame_overrides_json: null, frame_template_id: null, funnel_design_id: null },
      }) as unknown as ResolvedFunnelForRedirect;

    const plain = await loadRedirectLook(env, resolved(null, null));
    expect(plain?.css.badge).toBe("#1B3A5C");
    const themed = await loadRedirectLook(env, resolved({ version: 1, template: "centered" }, INSURISSIMO_THEME));
    expect(themed?.css.badge).toBe("#0B6E4F");
    expect(themed?.css.font_headline).toContain("Poppins");
    const saved = await loadRedirectLook(
      env,
      resolved({ version: 1, template: "centered", redirect: { headline: "Saved headline", background_role: "surface_wash" } }, INSURISSIMO_THEME),
    );
    expect(saved?.texts.headline).toBe("Saved headline");
    expect(saved?.css.background).toBe("#E3F4EC");
    // a funnel whose look comes from its applied saved Template (frame_template_id)
    const templateEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () =>
              sql.includes("FROM leadgen_frame_templates WHERE id = ?")
                ? { frame_json: JSON.stringify({ template: "centered", redirect: { headline: "From the Template", animation: "bar" } }) }
                : null,
          }),
        }),
      },
      CACHE: env.CACHE,
    };
    const templated = resolved(null, null);
    (templated.funnel as unknown as { frame_template_id: number }).frame_template_id = 7;
    const fromTemplate = await loadRedirectLook(templateEnv, templated);
    expect(fromTemplate?.texts.headline).toBe("From the Template");
    expect(fromTemplate?.animation).toBe("bar");
    // a database failure while reading the funnel's saved Template: null, never a throw
    const downEnv = { DB: { prepare: () => { throw new Error("D1 down"); } }, CACHE: env.CACHE };
    const withTemplate = resolved(null, null);
    (withTemplate.funnel as unknown as { frame_template_id: number }).frame_template_id = 5;
    expect(await loadRedirectLook(downEnv, withTemplate), "never throws to the caller").toBeNull();
  });
});

// ===========================================================================
// 3 · the banner
// ===========================================================================

describe("F11 · the redirect banner shows only the chosen card", () => {
  it("wraps the real cards, marks exactly the chosen one, leaves every link byte-identical", () => {
    const original = cards();
    const html = screen({}, null, original);
    const doc = miniDocument(html);
    const root = doc.querySelector("[data-lg-redirect]");
    expect(root).not.toBeNull();
    expect(root!.getAttribute("data-lg-rd-display")).toBe("banner");
    expect(root!.getAttribute("data-lg-rd-seconds")).toBe("5");
    expect(root!.getAttribute("data-lg-rd-slot")).toBe("2");
    expect(root!.getAttribute("data-lg-rd-brid")).toBe("BRID1");
    expect(root!.getAttribute("data-lg-rd-faid")).toBe("fa_1");
    expect(root!.getAttribute("data-lg-rd-hides")).toBe("offer");
    expect(root!.getAttribute("data-lg-rd-hides-key")).toBe("lgo_beta");
    expect(root!.getAttribute("data-lg-rd-live"), "inert until the page script claims it").toBeNull();

    const all = doc.querySelectorAll("a.lg-banner");
    expect(all.map((a) => a.getAttribute("data-slot"))).toEqual(["1", "2", "3"]); // the others are present, in order
    const chosen = doc.querySelectorAll("a.lg-banner[data-lg-rd-chosen]");
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.getAttribute("data-offer")).toBe("lgo_beta");
    // the cards are the original bytes with ONE attribute added to one tag
    expect(html).toContain(original.replace('<a class="lg-banner" href="/lg/lc/lgo_beta', '<a class="lg-banner" data-lg-rd-chosen="1" href="/lg/lc/lgo_beta'));
    for (const a of miniDocument(original).querySelectorAll("a.lg-banner")) {
      expect(html, "every card link is unchanged").toContain(`href="${a.getAttribute("href")!.replace(/&/g, "&amp;")}"`);
    }
    // while live, CSS keeps every other card off the screen (display:none)
    expect(REDIRECT_SCREEN_CSS).toContain(".lg-rd--banner[data-lg-rd-live] .lg-banner:not([data-lg-rd-chosen]){display:none!important}");
    // and the banner holds the chosen card between its head and "Stay here"
    expect(html.indexOf("lg-rd-head")).toBeLessThan(html.indexOf("lg-rd-cards"));
    expect(html.indexOf("lg-rd-cards")).toBeLessThan(html.indexOf("data-lg-rd-stay>"));
    expect(doc.querySelector("button[data-lg-rd-stay]")?.textContent).toBe("Stay here");
    expect(doc.querySelector("button[data-lg-rd-stay]")?.getAttribute("type")).toBe("button");
  });

  it("brand line and no-brand line (\"your offer\"), role=status, every operator text escaped", () => {
    const withBrand = miniDocument(screen());
    expect(withBrand.querySelector(".lg-rd-line")?.textContent).toBe("Taking you to Beta Co in 5…");
    expect(withBrand.querySelector(".lg-rd-line")?.getAttribute("role")).toBe("status");
    expect(withBrand.querySelector(".lg-rd-message")?.textContent).toBe("Beta Co will help you finish in a few steps.");
    expect(withBrand.querySelector(".lg-rd-badge")?.textContent).toBe("It’s a match");
    expect(withBrand.querySelector(".lg-rd-headline")?.textContent).toBe("We found an offer that fits you");

    const noBrand = miniDocument(screen({ brand: null }));
    expect(noBrand.querySelector(".lg-rd-line")?.textContent).toBe("Taking you to your offer in 5…");
    expect(noBrand.querySelector(".lg-rd-message")?.textContent).toBe("Your offer will help you finish in a few steps.");

    const hostile = screen({ brand: "<img src=x onerror=alert(1)> & {n}" }, { headline: "Tom & \"Jerry\" {brand}" });
    expect(hostile).not.toContain("<img src=x");
    expect(hostile).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; {n}");
    expect(hostile).toContain("Tom &amp; &quot;Jerry&quot;");
    // {n} lives in a span the page script rewrites each second
    expect(miniDocument(screen({ seconds: 9 })).querySelectorAll("[data-lg-rd-n]").map((n) => n.textContent)).toEqual(["9", "9"]);
  });

  it("with backfill (two renders, repeating slots) the card is the one whose own link carries the render id + slot", () => {
    const html = cards("BRID1") + cards("BRID2", [entry("delta", "Delta Co", 2, "lgo_beta"), entry("eps", "Eps Co", 3, "lgo_eps")]);
    const marked = markChosenCard(html, { slot: 2, offer_public_id: "lgo_beta", banner_render_id: "BRID2" });
    expect(marked?.brid).toBe("BRID2");
    expect(marked?.carrier_key).toBe("delta");
    const out = renderRedirectScreen({ banners_html: html, instruction: instruction({ banner_render_id: "BRID2", carrier_key: "delta" }), look: null });
    const doc = miniDocument(out);
    const chosen = doc.querySelectorAll("a.lg-banner[data-lg-rd-chosen]");
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.getAttribute("href")).toContain("brid=BRID2");
    expect(doc.querySelector("[data-lg-redirect]")?.getAttribute("data-lg-rd-brid")).toBe("BRID2");
    // a render id no card carries never falls back to a different card
    expect(markChosenCard(html, { slot: 2, offer_public_id: "lgo_beta", banner_render_id: "NOPE" })).toBeNull();
  });

  it("fail-safe: no chosen card or a bad instruction returns today's results UNCHANGED", () => {
    const html = cards();
    expect(renderRedirectScreen({ banners_html: html, instruction: instruction({ slot: 9 }), look: null })).toBe(html);
    expect(renderRedirectScreen({ banners_html: html, instruction: instruction({ seconds: 1 }), look: null })).toBe(html);
    expect(renderRedirectScreen({ banners_html: html, instruction: instruction({ seconds: 31 }), look: null })).toBe(html);
    expect(renderRedirectScreen({ banners_html: "", instruction: instruction(), look: null })).toBe("");
  });

  it("the viewability lookup (runtime/auction-client.ts slotTarget: [data-lg-slot], then [data-slot]) still lands on the chosen CARD", () => {
    const doc = miniDocument(`<div data-lg-banners>${screen()}</div>`);
    const mount = doc.querySelector("[data-lg-banners]")!;
    const target = mount.querySelector('[data-lg-slot="2"]') ?? mount.querySelector('[data-slot="2"]');
    expect(target?.tagName).toBe("A");
    expect(target?.getAttribute("data-lg-rd-chosen")).toBe("1");
    expect(screen()).not.toMatch(/\sdata-lg-slot=/);
  });
});

// ===========================================================================
// 4 · animation only
// ===========================================================================

describe("F11 · the animation-only screen shows no card", () => {
  it("animation (Large by default), headline, message, \"Show me all offers\" — and the cards hidden while live", () => {
    const html = screen({ display: "animation" });
    const doc = miniDocument(html);
    const root = doc.querySelector("[data-lg-redirect]")!;
    expect(root.getAttribute("data-lg-rd-display")).toBe("animation");
    expect(root.className).toContain("lg-rd--only");
    const head = doc.querySelector(".lg-rd-head")!;
    expect(head.querySelectorAll("a.lg-banner"), "no card in the screen itself").toHaveLength(0);
    expect(REDIRECT_SCREEN_CSS).toContain(".lg-rd--only[data-lg-rd-live] .lg-rd-cards{display:none!important}");
    expect(doc.querySelector(".lg-ra")?.className).toBe("lg-ra lg-ra--ring lg-ra--l");
    expect(doc.querySelector(".lg-rd-headline")?.textContent).toBe("Taking you to Beta Co…");
    expect(doc.querySelector(".lg-rd-message")?.textContent).toBe("You’ll continue on our partner’s site in a few seconds.");
    expect(doc.querySelector("button[data-lg-rd-stay]")?.textContent).toBe("Show me all offers");
    expect(doc.querySelector(".lg-rd-badge")).toBeNull();
    // the countdown is still announced (visually hidden status line)
    expect(doc.querySelector(".lg-rd-line.lg-rd-sr")?.getAttribute("role")).toBe("status");
    // the operator's size moves both screens (the animation-only one stays a step larger)
    expect(miniDocument(screen({ display: "animation" }, { animation_size: "s" })).querySelector(".lg-ra")?.className).toBe("lg-ra lg-ra--ring lg-ra--m");
    expect(miniDocument(screen({}, { animation_size: "s" })).querySelector(".lg-ra")?.className).toBe("lg-ra lg-ra--ring lg-ra--s");
    expect(miniDocument(screen()).querySelector(".lg-ra")?.className).toBe("lg-ra lg-ra--ring lg-ra--m");
  });
});

// ===========================================================================
// 5 · the five animations
// ===========================================================================

describe("F11 · the five CSS animations are timed to the rule's seconds and stand still under Reduce motion", () => {
  const animated: Record<string, string> = {
    ring: ".lg-ra-prog",
    bar: ".lg-ra-fill",
    logo_bar: ".lg-ra-logo",
    spinner: ".lg-ra-spin",
    dots: ".lg-ra-dot",
  };

  it("each style renders its own markup; Logo on a bar without a logo falls back to the ring", () => {
    for (const style of FRAME_REDIRECT_ANIMATIONS) {
      const html = renderCountdownAnimation({ style, size: "m", show_seconds: true, seconds: 7, logo_url: "https://cdn.example.com/l.png", logo_alt: "L" });
      expect(html).toContain(`lg-ra--${style} `);
      expect(html).toContain(animated[style]!.slice(1));
    }
    expect(renderCountdownAnimation({ style: "logo_bar", size: "m", show_seconds: true, seconds: 7, logo_url: null })).toContain("lg-ra--ring");
    expect(renderCountdownAnimation({ style: "logo_bar", size: "m", show_seconds: true, seconds: 7, logo_url: "javascript:alert(1)" })).toContain("lg-ra--ring");
    // "Show the seconds" (ring and bar)
    expect(renderCountdownAnimation({ style: "ring", size: "m", show_seconds: false, seconds: 7 })).not.toContain("data-lg-rd-n");
    expect(renderCountdownAnimation({ style: "bar", size: "m", show_seconds: true, seconds: 7 })).toContain(">7</span>");
  });

  it("each moving part runs exactly the countdown: one pass of --lg-ra-secs, or 1s loops counted by --lg-ra-turns", () => {
    const rules = COUNTDOWN_ANIMATION_CSS.split("}").map((r) => r + "}");
    for (const [style, sel] of Object.entries(animated)) {
      const rule = rules.find((r) => r.startsWith(`${sel}{`) && r.includes("animation"));
      expect(rule, `${style}: ${sel} has an animation`).toBeDefined();
      const timed = /animation:[^;}]*var\(--lg-ra-secs,5s\)[^;}]*forwards/.test(rule!) || (/animation:[^;}]*\b1s\b/.test(rule!) && /animation-iteration-count:var\(--lg-ra-turns,5\)/.test(rule!));
      expect(timed, `${style} is timed to the seconds: ${rule}`).toBe(true);
    }
    // the screen sets both from the rule's seconds
    const html = screen({ seconds: 12 });
    expect(html).toContain("--lg-ra-secs:12s;--lg-ra-turns:12");
  });

  it("under prefers-reduced-motion every moving part has animation:none, and the ring/bar show their current state", () => {
    const at = COUNTDOWN_ANIMATION_CSS.indexOf("@media (prefers-reduced-motion:reduce){");
    expect(at).toBeGreaterThan(-1);
    const block = COUNTDOWN_ANIMATION_CSS.slice(at);
    for (const sel of Object.values(animated)) expect(block).toMatch(new RegExp(`${sel.replace(".", "\\.")}[,{][^@]*animation:none!important`));
    expect(block).toContain("stroke-dashoffset:calc(175.93px * var(--lg-ra-p,0))");
    expect(block).toContain(".lg-ra-fill{width:calc(100% * var(--lg-ra-p,0))}");
    // paused while the tab is hidden
    expect(COUNTDOWN_ANIMATION_CSS).toContain("[data-lg-rd-paused] .lg-ra-prog");
  });
});

// ===========================================================================
// 6 · every key is alive
// ===========================================================================

describe("F11 · every L · Redirect key changes what the visitor is shown", () => {
  it("flipping any one key (to its non-default value) changes the rendered banner or animation-only screen", () => {
    const base = { banner: screen(), only: screen({ display: "animation" }) };
    for (const [key, value] of Object.entries(EVERY_VALUE)) {
      const banner = screen({}, { [key]: value });
      const only = screen({ display: "animation" }, { [key]: value });
      expect(banner !== base.banner || only !== base.only, `redirect.${key} paints something`).toBe(true);
    }
    // and REDIRECT_LOOK_DEFAULTS names exactly the stored keys
    expect(Object.keys(REDIRECT_LOOK_DEFAULTS).sort()).toEqual(Object.keys(EVERY_VALUE).sort());
  });
});
