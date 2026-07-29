// Round-4 P5a — authorable frame elements v2 (investigation B-2 10C/10E/10F/
// 10G/10H + 10H-adjacent + B-4.7). SERVER-SIDE legs over the pure frames.ts
// schema + frame.ts renderer + styles.ts CSS. Proves, per shape:
//   * schema validation (valid → zero problems; invalid → path-precise §3.6);
//   * BACK-COMPAT byte-parity — an empty/absent new key is a no-op, and a
//     legacy config emits NO P5a-only markup (old configs render identically);
//   * the free-text sanitizer rejects script/onclick/javascript:;
//   * every progress style renders VISUALLY DISTINCT (distinct markup/classes +
//     distinct chrome-CSS rules — the browser computed-style leg is the
//     Playwright spec __p5a-frame.spec.ts).
// Live per-page/per-condition TOGGLING is a runtime engine leg (documented
// seam) — this file proves the SERVER markup + the hooks it stamps.

import { describe, expect, it } from "vitest";

import { LG_BANNERS_MOUNT_HTML, LOGO_FALLBACK_CHIP_TEXT, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame, validateFrameConfig } from "../src/public/leadgen/designs/frames";
import type { FrameConfig, FrameTemplateId } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";
import type { SiteBranding } from "../src/leadgen/branding";
import { sanitizeFrameInlineHtml } from "../src/lib/inline-sanitizer";

const TOKENS = resolveTokens(defaultFunnelDesign);

const BRANDING: SiteBranding = {
  site_name: "Acme Insure",
  logo_url: "/media/site-logo.png",
  tagline: null,
  legal_links: [
    { label: "Privacy policy", href: "/privacy-policy" },
    { label: "Terms of use", href: "/terms" },
  ],
  trust_logos: null,
};
const BRANDING_NO_LOGO: SiteBranding = { ...BRANDING, logo_url: null };

const ROOT = {
  funnelId: "lgf_0000000000000000000FRAME01",
  funnelVariantId: "lgn_0000000000000000000FRAME02",
  quoteId: "lgq_0000000000000000000FRAME03",
  contentVersion: 1,
};

function composed(
  patch: FrameConfig,
  sectionCount = 2,
  opts: { template?: FrameTemplateId; branding?: SiteBranding | null; adminPreview?: boolean } = {},
): string {
  const { frame, problems } = effectiveFrame(opts.template ?? "centered", patch);
  expect(problems).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: opts.branding === undefined ? BRANDING : opts.branding,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount,
    root: ROOT,
    adminPreview: opts.adminPreview,
  };
  return renderQuoteFrame(input);
}

const FRAME_CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });

// ---------------------------------------------------------------------------
// BACK-COMPAT byte-parity — the empty/absent new key is a NO-OP, and a legacy
// config emits NO P5a-only markup (per evolved shape).
// ---------------------------------------------------------------------------

const P5A_MARKERS = [
  "lg-frame-freetext",
  "lg-frame-brand-logos",
  "lg-frame-cta",
  "lg-frame-trustrow",
  "lg-frame-disc2",
  "lg-frame-footer2",
  "lg-frame-logo-hint",
  "lg-steps--numbered",
  "lg-frame-progress--icon_on_track",
  "lg-frame-image", // follow-on (10G / Image24)
];

describe("P5a back-compat — old configs render byte-identical (no P5a markup leaks)", () => {
  it("a legacy frame (no P5a keys) emits ZERO P5a-only markup", () => {
    const html = composed({
      header: { cta: { enabled: true, label: "Call", href: null, tel: "+15551234567" } },
      disclosure: { enabled: true, location: "footer", text: "Legacy disclosure" },
      progress: { style: "bar", show_label: true },
      footer: { enabled: true, links_source: "manual", links: [{ label: "Privacy", href: "/p" }] },
    });
    for (const marker of P5A_MARKERS) expect(html, marker).not.toContain(marker);
    // the legacy header CTA + footer disclosure DO still render.
    expect(html).toContain("lg-frame-header-cta");
    expect(html).toContain("lg-frame-footer-disclosure");
  });

  it("empty new keys are a NO-OP (byte-identical to omitting them), per shape", () => {
    const base = composed({}, 3);
    expect(composed({ free_text: [] }, 3)).toBe(base);
    expect(composed({ cta_slots: [] }, 3)).toBe(base);
    expect(composed({ trust_rows: [] }, 3)).toBe(base);
    expect(composed({ brand_logos: { enabled: false, items: [], layout: "row" } }, 3)).toBe(base);
    expect(composed({ disclosure: { entries: [] } }, 3)).toBe(base);
    expect(composed({ footer: { blocks: [] } }, 3)).toBe(base);
    expect(composed({ images: [] }, 3)).toBe(base); // follow-on (10G / Image24)
  });

  it("a legacy footer (no blocks) renders the FooterBar, never footer2", () => {
    const html = composed({ footer: { enabled: true, trust_text: "Trusted" } });
    expect(html).toContain("lg-frame-footer");
    expect(html).not.toContain("lg-frame-footer2");
  });
});

// ---------------------------------------------------------------------------
// 10E free text — schema + sanitized render + typography + page targeting.
// ---------------------------------------------------------------------------

describe("P5a 10E free text", () => {
  const freeText = (over: Record<string, unknown> = {}) => ({
    free_text: [
      {
        id: "ft1",
        slot: "above_section",
        blocks: [
          { type: "paragraph", html: "<strong>Bold</strong> and <em>italic</em>" },
          { type: "list", style: "check", items: ["First point", "Second point"] },
        ],
        ...over,
      },
    ],
  });

  it("valid free text validates with zero problems and renders sanitized inline markup", () => {
    const { problems } = validateFrameConfig({ version: 1, template: "centered", ...freeText() });
    expect(problems).toEqual([]);
    const html = composed(freeText() as FrameConfig);
    expect(html).toContain('data-frame-region="free_text"');
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("lg-frame-freetext-list--check");
    expect(html).toContain("<li>First point</li>");
  });

  it("REJECTS an unknown slot / bad block type with a path-precise message", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      free_text: [{ id: "x", slot: "nowhere", blocks: [{ type: "video" }] }],
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.free_text[0].slot")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.free_text[0].blocks[0].type")).toBe(true);
  });

  it("SANITIZES script/onclick/javascript: out of author html (never raw)", () => {
    const html = composed({
      free_text: [
        {
          id: "ft-xss",
          slot: "below_section",
          blocks: [
            { type: "paragraph", html: '<script>alert(1)</script><strong>ok</strong>' },
            { type: "paragraph", html: '<a href="javascript:alert(2)">link</a>' },
            { type: "paragraph", html: '<b onclick="steal()">click</b>' },
            { type: "list", items: ['<a href="javascript:x">bad</a>', "clean"] },
          ],
        },
      ],
    } as FrameConfig);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
    // the safe formatting survives.
    expect(html).toContain("<strong>ok</strong>");
  });

  it("typography overrides map to token classes; text is escaped", () => {
    const html = composed({
      free_text: [
        {
          id: "ft2",
          slot: "above_header",
          align: "left",
          typography: { size: "l", color: "brand_primary", align: "right" },
          blocks: [{ type: "paragraph", text: "<b>not markup</b> & escaped" }],
        },
      ],
    } as FrameConfig);
    // typography.align wins over element align.
    expect(html).toContain("lg-frame-el--align-right");
    expect(html).toContain("lg-frame-el--size-l");
    expect(html).toContain("lg-frame-el--color-brand_primary");
    expect(html).toContain("&lt;b&gt;not markup&lt;/b&gt; &amp; escaped");
  });

  it("page targeting: all=no gate, first=data-show-on, range/list bake page-1 + stamp data-frame-pages", () => {
    // Scope every assertion to the free-text REGION's own opening tag (the
    // footer legitimately carries its own data-show-on="all").
    const ftTag = (html: string, id: string): string => {
      const m = html.match(new RegExp(`<div[^>]*data-free-text-id="${id}"[^>]*>`));
      expect(m, `free_text region ${id}`).not.toBeNull();
      return (m as RegExpMatchArray)[0];
    };

    const all = ftTag(composed({ free_text: [{ id: "a", slot: "above_section", blocks: [{ type: "paragraph", text: "x" }], pages: { mode: "all" } }] } as FrameConfig), "a");
    expect(all).not.toContain("data-show-on");
    expect(all).not.toContain("data-frame-pages");
    expect(all).not.toContain("hidden");

    const first = ftTag(composed({ free_text: [{ id: "b", slot: "above_section", blocks: [{ type: "paragraph", text: "x" }], pages: { mode: "first" } }] } as FrameConfig), "b");
    expect(first).toContain('data-show-on="first"');
    expect(first).not.toContain("hidden");

    const rangeExcl = ftTag(composed({ free_text: [{ id: "c", slot: "above_section", blocks: [{ type: "paragraph", text: "x" }], pages: { mode: "range", from: 2, to: 3 } }] } as FrameConfig), "c");
    expect(rangeExcl).toContain('data-frame-pages="range:2-3"');
    // excludes page 1 → baked hidden (safe default on the cached shell).
    expect(rangeExcl).toContain("hidden");

    const listFirstOnly = ftTag(composed({ free_text: [{ id: "d", slot: "above_section", blocks: [{ type: "paragraph", text: "x" }], pages: { mode: "list", pages: [1] } }] } as FrameConfig), "d");
    expect(listFirstOnly).toContain('data-frame-pages="list:1"');
    expect(listFirstOnly).toContain('data-show-on="first"');
    expect(listFirstOnly).not.toContain("hidden"); // includes page 1 → visible
  });
});

// ---------------------------------------------------------------------------
// SECURITY FIX (adversarial review MAJOR-1, ship-blocker) — the free-text
// html sink previously ran through editor/sanitize.ts's STRIP/BLOCKLIST
// sanitizeHtml, which the reviewer broke live with a 5-payload corpus. The
// sink now runs lib/inline-sanitizer.ts's ALLOWLIST re-serializer instead —
// {p,strong,b,em,i,a[safe href],ul,ol,li,br,span} ONLY; every other element
// (script/style/img/audio/iframe/object/embed/…) is DROPPED ENTIRELY,
// regardless of spelling/casing/spacing/entity-encoding. Proves, per the
// EXACT corpus the reviewer supplied: each payload neutralized (both at
// RENDER time via the composed frame, and at STORE time via
// validateFrameConfig directly) + the legitimate cases (bold/italic/link/
// ✓-list) still render.
// ---------------------------------------------------------------------------

describe("P5a security fix (MAJOR-1) — allowlist re-serializer neutralizes the 5-payload XSS corpus", () => {
  // The EXACT 5 payloads the adversarial reviewer found surviving verbatim
  // against the old strip/blocklist sanitizer, run through the render path
  // (composed full frame HTML) via a paragraph block's `html` field.
  const CORPUS: Array<{ name: string; payload: string; mustNotContain: string[] }> = [
    {
      name: "img onerror, no leading space before on* (quote-adjacent)",
      payload: '<img src="x"onerror="alert(1)">',
      mustNotContain: ["<img", "onerror", "alert(1)", "src=\"x\""],
    },
    {
      name: "img onerror, slash-adjacent (HTML5-tolerant separator)",
      payload: '<img/onerror="alert(1)" src="x">',
      mustNotContain: ["<img", "onerror", "alert(1)"],
    },
    {
      name: "audio onerror (tag absent from any enumerable blocklist)",
      payload: '<audio src="x"onerror="alert(1)">',
      mustNotContain: ["<audio", "onerror", "alert(1)"],
    },
    {
      name: "iframe srcdoc, double-encoded entities (single-pass decode miss)",
      payload: '<iframe srcdoc="&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;">',
      mustNotContain: ["<iframe", "srcdoc", "<script", "alert(1)"],
    },
    {
      name: "iframe arbitrary embed / phishing",
      payload: '<iframe src="https://evil.example.com">',
      mustNotContain: ["<iframe", "evil.example.com"],
    },
  ];

  // Scope to the free-text REGION's own content (the composed frame
  // legitimately carries an unrelated <img> for the site's own header logo —
  // asserting "not.toContain('<img')" over the WHOLE page would be a false
  // positive; none of the allowlisted tags include <div>, so a non-greedy
  // match to the region's OWN closing </div> is exact).
  function freeTextRegionHtml(html: string, id: string): string {
    const m = html.match(new RegExp(`<div[^>]*data-free-text-id="${id}"[^>]*>([\\s\\S]*?)</div>`));
    expect(m, `free_text region ${id}`).not.toBeNull();
    return (m as RegExpMatchArray)[1]!;
  }

  it.each(CORPUS)("RENDER-time: $name renders INERT (dangerous construct fully absent)", ({ payload, mustNotContain }) => {
    const html = composed({
      free_text: [{ id: "ft_corpus", slot: "below_section", blocks: [{ type: "paragraph", html: payload }] }],
    } as FrameConfig);
    const region = freeTextRegionHtml(html, "ft_corpus");
    for (const bad of mustNotContain) expect(region, `payload=${payload} bad=${bad}`).not.toContain(bad);
  });

  it.each(CORPUS)("STORE-time: $name — validateFrameConfig sanitizes so the raw string never persists", ({ payload, mustNotContain }) => {
    const raw = {
      version: 1,
      template: "centered",
      free_text: [{ id: "ft_store", slot: "below_section", blocks: [{ type: "paragraph", html: payload }] }],
    };
    const { config, problems } = validateFrameConfig(raw);
    expect(problems.filter((p) => p.severity === "error"), `payload=${payload}`).toEqual([]);
    expect(config, `payload=${payload}`).not.toBeNull();
    // the SAME object validateFrameConfig returns is what frame-handlers.ts's
    // PUT /funnels/:id/frame handler JSON.stringifies and persists — assert
    // directly on the field the caller would store.
    const storedHtml = (config as unknown as { free_text: Array<{ blocks: Array<{ html: string }> }> }).free_text[0]!
      .blocks[0]!.html;
    for (const bad of mustNotContain) expect(storedHtml, `payload=${payload} bad=${bad}`).not.toContain(bad);
    // AND raw itself was mutated in place (the exact mechanism that makes the
    // fix work with zero changes to frame-handlers.ts).
    expect(raw.free_text[0]!.blocks[0]!.html).toBe(storedHtml);
    expect(raw.free_text[0]!.blocks[0]!.html).not.toBe(payload);
  });

  it("a MIXED string (legit tag + injected dangerous tag together) is not selectively bypassed", () => {
    // The old code's pre-check regex only invoked the blocklist sanitizer when
    // the string LOOKED like it contained an allowed tag — meaning a string
    // combining a legit tag with an injected payload took the vulnerable path
    // regardless. The new sanitizer ALWAYS runs, tag-by-tag, so this can never
    // happen: the legit part survives, the injected part is dropped, always.
    const html = composed({
      free_text: [
        {
          id: "ft_mixed",
          slot: "below_section",
          blocks: [{ type: "paragraph", html: '<strong>Free quote</strong><img src="x"onerror="alert(1)"><em>today</em>' }],
        },
      ],
    } as FrameConfig);
    const region = freeTextRegionHtml(html, "ft_mixed");
    expect(region).toContain("<strong>Free quote</strong>");
    expect(region).toContain("<em>today</em>");
    expect(region).not.toContain("<img");
    expect(region).not.toContain("onerror");
    expect(region).not.toContain("alert(1)");
  });

  it("VALID formatting still renders correctly: bold/italic/link/✓-list", () => {
    const html = composed({
      free_text: [
        {
          id: "ft_valid",
          slot: "below_section",
          blocks: [
            { type: "paragraph", html: "<strong>Bold</strong> and <em>italic</em> and <b>b</b> and <i>i</i>" },
            { type: "paragraph", html: '<a href="https://example.com/quote">Get a quote</a>' },
            { type: "list", style: "check", items: ["First point", "<strong>Second</strong> point"] },
          ],
        },
      ],
    } as FrameConfig);
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<b>b</b>");
    expect(html).toContain("<i>i</i>");
    expect(html).toContain('<a href="https://example.com/quote">Get a quote</a>');
    expect(html).toContain("<li>First point</li>");
    expect(html).toContain("<li><strong>Second</strong> point</li>");
    expect(html).toContain("lg-frame-freetext-list--check");
  });

  it("tel:/mailto: hrefs are preserved (the allowed schemes beyond http(s))", () => {
    expect(sanitizeFrameInlineHtml('<a href="tel:+15551234567">Call</a>')).toBe('<a href="tel:+15551234567">Call</a>');
    expect(sanitizeFrameInlineHtml('<a href="mailto:info@example.com">Email</a>')).toBe(
      '<a href="mailto:info@example.com">Email</a>',
    );
  });

  it("R2 P3 tail item 3 — a root-relative href (an authored link to a legal page, e.g. /licenses) survives; a fragment survives; protocol-relative //host is still rejected", () => {
    // owner clause: "free text (rich toolbar)" + "links to legal pages" — an
    // authored <a href="/licenses"> was being silently stripped to a bare,
    // non-navigable <a> (SAFE_HREF_SCHEME_RE only recognized http(s)/tel/
    // mailto SCHEMES, never a bare relative path). Widened to match
    // designs/frames.ts's own SAFE_HREF_RE class exactly.
    expect(sanitizeFrameInlineHtml('<a href="/licenses">Licenses</a>')).toBe('<a href="/licenses">Licenses</a>');
    expect(sanitizeFrameInlineHtml('<a href="#section-2">Jump</a>')).toBe('<a href="#section-2">Jump</a>');
    // protocol-relative //host is NEVER allowed (the negative lookahead in
    // the shared class) — a same-scheme cross-origin redirect vector.
    expect(sanitizeFrameInlineHtml('<a href="//evil.host/x">bad</a>')).toBe("<a>bad</a>");
  });

  it("an unsafe href (javascript:/data:) drops the href but keeps the inert text", () => {
    expect(sanitizeFrameInlineHtml('<a href="javascript:alert(1)">click</a>')).toBe("<a>click</a>");
    expect(sanitizeFrameInlineHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>')).toBe("<a>click</a>");
  });

  it("a double/triple-encoded javascript: href is rejected too (fixpoint decode, allowlist scheme check)", () => {
    // &amp;#106;avascript: -> (decode 1) &#106;avascript: -> (decode 2) javascript:
    // — a single-pass decoder would see "&#106;avascript:" and (correctly, for
    // ITS OWN single-pass contract) not recognize it as javascript: yet; a
    // fixpoint decoder reveals it, and the ALLOWLIST scheme check (not a
    // javascript: blocklist) rejects it regardless of decode depth.
    const out = sanitizeFrameInlineHtml('<a href="&amp;#106;avascript:alert(1)">click</a>');
    expect(out).toBe("<a>click</a>");
    expect(out).not.toContain("javascript:");
  });

  it("script/style tag content never survives as executable markup — only as inert escaped text", () => {
    expect(sanitizeFrameInlineHtml("<script>alert(1)</script>")).toBe("alert(1)");
    expect(sanitizeFrameInlineHtml("<style>body{background:url(x)}</style>")).toBe("body{background:url(x)}");
  });

  it("unknown/malformed tag-like text in prose is escaped, not rejected (forgiving of casual authoring)", () => {
    expect(sanitizeFrameInlineHtml("if x < 5 and y > 3")).toBe("if x &lt; 5 and y &gt; 3");
  });

  it("unclosed tags are auto-closed at EOF (never leaves dangling markup)", () => {
    expect(sanitizeFrameInlineHtml("<strong>bold forever")).toBe("<strong>bold forever</strong>");
  });

  it("case-insensitive matching: SCRIPT/IMG in any case are still dropped (attrs never survive; a dropped tag's OWN inner text is inert, matching the documented script/style behavior above)", () => {
    const out = sanitizeFrameInlineHtml('<SCRIPT>alert(1)</SCRIPT><StRoNg>ok</StRoNg><IMG SRC="x" ONERROR="alert(2)">');
    // the disallowed IMG tag's own attribute name/value never survive at all
    // (fully consumed as part of dropping the whole tag construct).
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<IMG");
    expect(out).not.toContain("ONERROR");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert(2)");
    // the mixed-case allowed tag still renders correctly.
    expect(out).toContain("<strong>ok</strong>");
    // the SCRIPT tag's own INNER TEXT (between its open/close) is inert plain
    // text once its tag delimiters are dropped — expected, matches the
    // dedicated script/style test above (never executable, just visible copy).
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<SCRIPT");
    expect(out).toContain("alert(1)");
  });
});

// ---------------------------------------------------------------------------
// 10F brand logos.
// ---------------------------------------------------------------------------

describe("P5a 10F brand logos", () => {
  it("valid strip validates + renders via the LogoStrip preset with layout/align classes", () => {
    const cfg = {
      brand_logos: {
        enabled: true,
        layout: "row",
        align: "center",
        items: [
          { url: "/media/a.svg", alt: "Partner A" },
          { media_id: "med_b", alt: "Partner B" },
        ],
      },
    };
    expect(validateFrameConfig({ version: 1, template: "centered", ...cfg }).problems).toEqual([]);
    const html = composed(cfg as FrameConfig);
    expect(html).toContain('data-frame-region="brand_logos"');
    expect(html).toContain("lg-frame-brand-logos--row");
    expect(html).toContain("lg-logo-strip");
    expect(html).toContain('alt="Partner A"');
  });

  it("REJECTS a logo with neither media_id nor a safe url, and a bad layout", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      brand_logos: { enabled: true, layout: "diagonal", items: [{ alt: "x" }] },
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.brand_logos.layout")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.brand_logos.items[0]")).toBe(true);
  });

  it("row/grid layout classes drive the desktop-row / mobile-grid CSS presets", () => {
    expect(FRAME_CSS).toContain(".lg-frame-brand-logos--grid .lg-logo-strip");
    // mobile reflow: a row strip becomes a grid inside the media query.
    expect(FRAME_CSS).toContain(".lg-frame-brand-logos--row .lg-logo-strip");
  });
});

// ---------------------------------------------------------------------------
// 10C CTA / phone slots (four slots, alignment, tel:, conditional hidden hook).
// ---------------------------------------------------------------------------

describe("P5a 10C CTA/phone slots", () => {
  it("renders a slot in EACH of the four placements with a tel: link", () => {
    const slots = ["header_right", "under_header", "section_bottom", "footer"] as const;
    const html = composed({
      cta_slots: slots.map((slot) => ({ slot, label: "", tel: "+1 555 111 2222" })),
    } as FrameConfig);
    for (const slot of slots) expect(html, slot).toContain(`lg-frame-cta--${slot}`);
    // phone-only slot defaults the label to "Call now"; tel gets a tel: href.
    expect(html).toContain('href="tel:+1 555 111 2222"');
    expect(html).toContain(">Call now</a>");
  });

  it("header_right rides its own right container + adds the header --has-right modifier", () => {
    const html = composed({ cta_slots: [{ slot: "header_right", label: "Call us", tel: "+15550000000" }] } as FrameConfig);
    expect(html).toContain("lg-frame-header-right");
    expect(html).toContain("lg-frame-header--has-right");
    // the header-right CTA respects logo_align (kills hard-center): CSS proof.
    expect(FRAME_CSS).toContain(".lg-frame-header--left .lg-frame-header-extras");
    expect(FRAME_CSS).toContain(".lg-frame-header--has-right .lg-header-inner");
  });

  it("a CONDITIONAL slot server-renders HIDDEN with the evaluator hook + the compiled group", () => {
    const html = composed({
      cta_slots: [
        {
          id: "cta_state",
          slot: "under_header",
          label: "CA line",
          tel: "+15551110000",
          condition: { match: "all", conditions: [{ when: "__state", op: "eq", value: "CA" }] },
        },
      ],
    } as FrameConfig);
    // hidden markup + the EXISTING evaluator hook (data-lg-node) + compiled group.
    expect(html).toMatch(/data-frame-region="cta"[^>]*hidden/);
    expect(html).toContain('data-lg-node="cta_state"');
    expect(html).toContain("data-lg-cta-condition=");
    expect(html).toContain("__state");
  });

  it("a NON-conditional slot is visible (no hidden, no hook)", () => {
    const html = composed({ cta_slots: [{ slot: "footer", label: "Call", tel: "+15551110000" }] } as FrameConfig);
    expect(html).not.toMatch(/data-frame-region="cta"[^>]*hidden/);
    expect(html).not.toContain("data-lg-node=");
  });

  it("REJECTS a slot with neither tel nor href, and a bad slot name", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      cta_slots: [{ slot: "sidebar", label: "x" }],
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.cta_slots[0].slot")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.cta_slots[0]")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10H-adjacent disclosure v2 — per-location entries, full|hover, top+bottom.
// ---------------------------------------------------------------------------

describe("P5a disclosure v2", () => {
  it("top + bottom entries render simultaneously; full=inline, hover=CSS tooltip", () => {
    const html = composed({
      disclosure: {
        enabled: true,
        entries: [
          { location: "top", text: "Top full disclosure", mode: "full", align: "center" },
          { location: "bottom", text: "Bottom hover disclosure", mode: "hover", link_label: "Details" },
        ],
      },
    } as FrameConfig);
    expect(html).toContain("lg-frame-disc2-region--top");
    expect(html).toContain("lg-frame-disc2-region--bottom");
    expect(html).toContain("lg-frame-disc2--full");
    expect(html).toContain("lg-frame-disc2--hover");
    // hover mode = focusable trigger + role=tooltip (a11y, CSS-only).
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(">Details</span>");
  });

  it("REJECTS a bad location / mode", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      disclosure: { enabled: true, entries: [{ location: "middle", text: "x", mode: "flash" }] },
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.disclosure.entries[0].location")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.disclosure.entries[0].mode")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10H footer v2 — block model + own palette/typography scope.
// ---------------------------------------------------------------------------

describe("P5a footer v2", () => {
  const footerBlocks: FrameConfig = {
    footer: {
      enabled: true,
      palette_scope: { background: "brand_primary", text: "card_background", link: "accent" },
      typography_scope: { size: "s" },
      blocks: [
        { type: "about_paragraph", text: "Operated by Acme Inc." },
        { type: "link_row", links_source: "site" },
        { type: "link_row", links_source: "manual", links: [{ label: "Careers", href: "/careers" }] },
        { type: "logo" },
        { type: "address", text: "1 Main St" },
        { type: "socials", socials: [{ platform: "X", url: "https://x.com/acme" }] },
        { type: "disclosure", text: "Compensation disclosure." },
      ],
    },
  };

  it("valid blocks validate + render each type; scope emits footer custom properties", () => {
    expect(validateFrameConfig({ version: 1, template: "centered", ...footerBlocks }).problems).toEqual([]);
    const html = composed(footerBlocks);
    expect(html).toContain("lg-frame-footer2");
    expect(html).toContain("lg-frame-footer2-about");
    expect(html).toContain("lg-frame-footer2-links");
    expect(html).toContain("lg-frame-footer2-logo");
    expect(html).toContain("lg-frame-footer2-address");
    expect(html).toContain("lg-frame-footer2-social");
    expect(html).toContain("lg-frame-footer2-disclosure");
    // site link_row sources SiteBranding.legal_links.
    expect(html).toContain(">Privacy policy</a>");
    expect(html).toContain(">Careers</a>");
    // own palette/typography scope → inline custom properties on the footer.
    expect(html).toContain("--lg-footer-bg:var(--lg-role-brand_primary)");
    expect(html).toContain("--lg-footer-size:var(--lg-footer-size-s)");
  });

  it("REJECTS a bad block type and an unsafe manual link href", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      footer: {
        enabled: true,
        blocks: [
          { type: "carousel" },
          { type: "link_row", links_source: "manual", links: [{ label: "Evil", href: "javascript:alert(1)" }] },
        ],
      },
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.footer.blocks[0].type")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.footer.blocks[1].links[0].href")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10G trust / benefit rows — icon + text + CSS-only tooltip.
// ---------------------------------------------------------------------------

describe("P5a 10G trust rows", () => {
  it("renders Tabler icon svg + text + a CSS-only hover tooltip", () => {
    const html = composed({
      trust_rows: [
        {
          items: [
            { icon: "shield-check", text: "Secure", tooltip: "256-bit encryption" },
            { icon: "star", text: "Rated 4.9" },
          ],
        },
      ],
    } as FrameConfig);
    expect(html).toContain('data-frame-region="trust_row"');
    expect(html).toContain("lg-frame-trustrow-icon");
    expect(html).toContain("<svg"); // a real icon resolved from LEADGEN_ICONS
    expect(html).toContain("lg-frame-trustrow-text");
    // tooltip a11y: role=tooltip + title + focusable.
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('title="256-bit encryption"');
    expect(FRAME_CSS).toContain(".lg-frame-trustrow-item:hover .lg-frame-trustrow-tip");
  });

  it("REJECTS a row with no items / an item missing icon or text", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      trust_rows: [{ items: [{ text: "no icon" }] }],
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.trust_rows[0].items[0].icon")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10D / B-4.7 progress v2 — every style renders VISUALLY DISTINCT.
// ---------------------------------------------------------------------------

describe("P5a progress v2 — distinct styles (markup + chrome CSS)", () => {
  const render = (style: string) => composed({ progress: { style: style as never, show_label: true } }, 4);

  it("each style stamps a distinct region class", () => {
    for (const style of ["bar", "dots", "numbered", "percent", "icon_on_track"]) {
      expect(render(style)).toContain(`lg-frame-progress--${style}`);
    }
  });

  it("numbered is NO LONGER a bar-alias — real numbered circles (with numbers), engine-advanced", () => {
    const numbered = render("numbered");
    const bar = render("bar");
    expect(numbered).toContain("lg-steps--numbered");
    expect(numbered).toMatch(/<span class="lg-step"[^>]*>1<\/span>/); // the number IS in the circle
    expect(bar).not.toContain("lg-steps--numbered");
    // the pinned engine contract (leadgen-frame-progress-back) still holds:
    expect(numbered).toContain('data-mode="step"');
    expect(numbered).toContain('aria-valuetext="Step 1 of 4"');
    expect(numbered).toContain("data-lg-progress-label>Step 1 of 4</div>");
    // distinct MARKUP shape: bar has a linear track, numbered has step circles.
    expect(bar).toContain("lg-progress-track");
    expect(numbered).not.toContain("lg-progress-track");
  });

  it("dots vs numbered: dots keep EMPTY circles, numbered carry numbers", () => {
    const dots = render("dots");
    expect(dots).toContain("lg-steps");
    expect(dots).not.toContain("lg-steps--numbered");
    // dots circles are empty (no digit content).
    expect(dots).toMatch(/<span class="lg-step"[^>]*><\/span>/);
  });

  it("icon_on_track rides a bar track with a thumb pseudo-element (distinct CSS)", () => {
    const icon = render("icon_on_track");
    expect(icon).toContain("lg-progress-track");
    expect(FRAME_CSS).toContain(".lg-frame-progress--icon_on_track .lg-progress-fill::after");
  });

  it("percent puts the label INSIDE the fill (absolute over the track — distinct CSS)", () => {
    expect(FRAME_CSS).toContain(".lg-frame-progress--percent .lg-progress-text");
    // distinct positioning rule vs the bar's separate label line.
    expect(FRAME_CSS).toMatch(/\.lg-frame-progress--percent \.lg-progress-text\{[^}]*position:absolute/);
  });

  it("label honesty: dots stop force-hiding the label when show_label is on", () => {
    const dotsNoLabel = composed({ progress: { style: "dots", show_label: false } }, 3);
    const dotsLabel = composed({ progress: { style: "dots", show_label: true } }, 3);
    expect(dotsNoLabel).toContain("data-lg-progress-label hidden></span>");
    expect(dotsLabel).toContain("data-lg-progress-label></span>");
    expect(dotsLabel).not.toContain("data-lg-progress-label hidden");
  });

  it("progress alignment is authorable + CSS-backed", () => {
    expect(composed({ progress: { style: "bar", align: "left" } }, 3)).toContain("lg-frame-progress--align-left");
    expect(FRAME_CSS).toContain(".lg-frame-progress--align-left");
  });

  it("icon_on_track + align validate with zero problems", () => {
    expect(
      validateFrameConfig({
        version: 1,
        template: "centered",
        progress: { style: "icon_on_track", position: "above_unit", thickness: "m", width: "full", color_role: "accent", show_label: true, align: "center" },
      }).problems,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10B real site logo in preview — admin-preview-only "no logo set" hint.
// ---------------------------------------------------------------------------

describe("P5a 10B site-logo preview hint", () => {
  it("adminPreview + a site WITH a logo → real logo, no hint", () => {
    const html = composed({}, 2, { adminPreview: true, branding: BRANDING });
    expect(html).toContain('src="/media/site-logo.png"'); // the REAL resolved logo
    expect(html).not.toContain("lg-frame-logo-hint");
  });

  // Rework §8.8 (#11A), Appendix A-8: REPAIRED (P4 S4.2) — the admin-preview-
  // only "no logo set" hint (frame.ts's OLD renderNoLogoHint, sitting
  // ALONGSIDE a still-bare site_name text mark) is SUPERSEDED by the honest
  // placeholder chip, which is now the UNCONDITIONAL floor-leg rendering
  // (live AND preview — see frame.ts's renderLogoFallbackChip doc comment:
  // the bare-text mark was ground truth #11A's REAL live defect, not an
  // admin-only cosmetic gap). This test's OWN intent — "a logo-less site
  // shows an explicit hint, never a bare unexplained mark" — is what the
  // chip now proves, more strongly (it holds live too, not just in preview).
  it("adminPreview + a site with NO logo → the A-8 fallback chip appears (never the bare site_name mark)", () => {
    const html = composed({}, 2, { adminPreview: true, branding: BRANDING_NO_LOGO });
    expect(html).toContain("lg-frame-logo-fallback");
    expect(html).toContain(LOGO_FALLBACK_CHIP_TEXT);
    // No siteSettingsHref supplied by this helper -> the admin-only LINK
    // affordance stays absent (never a guessed/fabricated href); the chip
    // TEXT itself is what this test asserts, unconditionally present.
    expect(html).not.toContain("Open Site settings");
  });

  it("LIVE serve (adminPreview absent) shows the SAME chip — the fix is NOT admin-preview-gated (only the optional link is)", () => {
    const live = composed({}, 2, { branding: BRANDING_NO_LOGO });
    const liveExplicitFalse = composed({}, 2, { adminPreview: false, branding: BRANDING_NO_LOGO });
    const preview = composed({}, 2, { adminPreview: true, branding: BRANDING_NO_LOGO });
    expect(live).toContain("lg-frame-logo-fallback");
    expect(live).toBe(liveExplicitFalse);
    // The chip's CORE content is byte-identical whether previewed or live —
    // only an (unsupplied-here) siteSettingsHref-gated link could ever add a
    // preview-only byte, and none is supplied by this helper.
    expect(live).toBe(preview);
  });
});

// ---------------------------------------------------------------------------
// P5a follow-on (10G / Image24) — first-class placed images. Previously an AI
// persona image had no dedicated element and rode a brand_logos item (wrong:
// a logo STRIP vs ONE placed visual). `images[]` is the general element (a
// persona image is just an image with a generated ref + optional caption).
// ---------------------------------------------------------------------------

describe("P5a follow-on 10G images (persona / placed image)", () => {
  it("valid image (url ref) validates zero problems + renders an <img> with alt", () => {
    const cfg = {
      images: [{ id: "img1", url: "/media/ai/site1/persona/warm-elder.png", alt: "A warm, trustworthy senior", slot: "above_section" as const }],
    };
    expect(validateFrameConfig({ version: 1, template: "centered", ...cfg }).problems).toEqual([]);
    const html = composed(cfg as FrameConfig);
    expect(html).toContain('data-frame-region="image"');
    expect(html).toContain('data-image-id="img1"');
    expect(html).toContain('src="/media/ai/site1/persona/warm-elder.png"');
    expect(html).toContain('alt="A warm, trustworthy senior"');
    expect(html).toContain("lg-frame-image--m"); // default size
  });

  it("a bare storage-key media_id resolves through mediaUrl() (the SAME dual-shape as brand_logos)", () => {
    const html = composed({
      images: [{ id: "img2", media_id: "ai/site1/persona/young-salesman.png", alt: "A young salesman", slot: "below_section" }],
    } as FrameConfig);
    expect(html).toContain('src="/media/ai/site1/persona/young-salesman.png"');
  });

  it("a hover tooltip renders the SAME CSS-only pattern as trust rows (title + focusable + role=tooltip)", () => {
    const html = composed({
      images: [{ id: "img3", url: "/media/p.png", alt: "Persona", slot: "above_header", tooltip: "Secured & verified" }],
    } as FrameConfig);
    expect(html).toContain('title="Secured &amp; verified"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain(">Secured &amp; verified</span>");
  });

  it("NO tooltip markup when tooltip is absent", () => {
    const html = composed({ images: [{ id: "img4", url: "/media/p.png", alt: "Persona", slot: "above_header" }] } as FrameConfig);
    expect(html).not.toContain("lg-frame-image-tip");
    expect(html).not.toContain('role="tooltip"');
  });

  it("size + align are authorable + CSS-backed", () => {
    const html = composed({
      images: [{ id: "img5", url: "/media/p.png", alt: "Persona", slot: "below_footer", size: "l", align: "right" }],
    } as FrameConfig);
    expect(html).toContain("lg-frame-image--l");
    expect(html).toContain("lg-frame-el--align-right");
    expect(FRAME_CSS).toContain(".lg-frame-image--l .lg-frame-image-img");
    expect(FRAME_CSS).toContain(".lg-frame-image-wrap:hover .lg-frame-image-tip");
  });

  it("page targeting reuses the SAME data-show-on/data-frame-pages machinery as free_text", () => {
    const imgTag = (html: string, id: string): string => {
      const m = html.match(new RegExp(`<div[^>]*data-image-id="${id}"[^>]*>`));
      expect(m, `image region ${id}`).not.toBeNull();
      return (m as RegExpMatchArray)[0];
    };
    const first = imgTag(
      composed({ images: [{ id: "pf", url: "/media/p.png", alt: "x", slot: "above_section", pages: { mode: "first" } }] } as FrameConfig),
      "pf",
    );
    expect(first).toContain('data-show-on="first"');
    const rangeExcl = imgTag(
      composed({ images: [{ id: "pr", url: "/media/p.png", alt: "x", slot: "above_section", pages: { mode: "range", from: 2, to: 3 } }] } as FrameConfig),
      "pr",
    );
    expect(rangeExcl).toContain('data-frame-pages="range:2-3"');
    expect(rangeExcl).toContain("hidden");
  });

  it("REJECTS an image with neither media_id nor a safe url, no alt, and a bad slot", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      images: [{ id: "bad1", slot: "sidebar" }],
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.images[0]")).toBe(true); // no media_id/url
    expect(bad.problems.some((p) => p.path === "frame.images[0].alt")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.images[0].slot")).toBe(true);
  });

  it("REJECTS an unsafe url (javascript:) and a missing id", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      images: [{ url: "javascript:alert(1)", alt: "x", slot: "above_section" }],
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.images[0].id")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.images[0]")).toBe(true); // the unsafe url doesn't count as a resolvable src
  });

  it("REJECTS a bad size / align / non-string tooltip", () => {
    const bad = validateFrameConfig({
      version: 1,
      template: "centered",
      images: [{ id: "x", url: "/media/p.png", alt: "x", slot: "above_section", size: "xxl", align: "diagonal", tooltip: 123 }],
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.images[0].size")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.images[0].align")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.images[0].tooltip")).toBe(true);
  });

  it("an image with no resolvable src renders NOTHING (fail-safe, never a broken <img>)", () => {
    // Bypass validation (a hand-built config) to prove the RENDERER's own
    // defensive filter, mirroring renderBrandLogos' fail-safe discipline.
    const html = composed({ images: [{ id: "x", alt: "x", slot: "above_section" }] } as unknown as FrameConfig);
    expect(html).not.toContain("lg-frame-image");
  });
});
