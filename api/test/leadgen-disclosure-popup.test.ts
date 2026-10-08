// OWNER 2026-08-23 (Quotes → Templates → D · Disclosure): "The 'Advertising
// disclosure' menu on the header should open a pop-up with text on it → right
// now it's not working, also, Disclosure should be applied only if activated
// (right now no option to activation/deactivation)."
//
// DRIVEN FAIL-BEFORE on his live moneylantern.com/lg/business-loans:
//   * the link was `<button class="lg-disclosure" aria-expanded="false">` beside
//     `<div class="lg-disclosure-panel" hidden>`. Clicking it left aria-expanded
//     at "false" — because NOTHING toggled it. The public runtime bundle has
//     zero references to `lg-disclosure`; styles.ts's own modal rule even said
//     so ("hidden toggle unchanged — no new runtime dependency"). An inert
//     control that looked interactive.
//   * that panel was EMPTY. His stored config is `text: ""`, and only the
//     FOOTER leg required non-empty text — the three toggle legs painted a link
//     with nothing behind it.
//   * panel D offered ONLY the v2 `disclosure.entries` list. `disclosure.enabled`
//     has always existed in the schema, been validated, and been honoured by
//     every location leg — but no control wrote it, so an operator could not turn
//     the disclosure off. Nor was there anywhere to type the text.
//     test/leadgen-quote-builder-ui.test.ts pinned that gap explicitly ("no
//     current admin surface"); that pin is now flipped to record the fix.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";
import { LEADGEN_RUNTIME_JS } from "../src/public/leadgen/runtime/engine-bundle.generated";

const TOKENS = resolveTokens(defaultFunnelDesign);
const CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE);
const ROOT = {
  funnelId: "lgf_0000000000000000000DISC01",
  funnelVariantId: "lgn_0000000000000000000DISC02",
  quoteId: "lgq_0000000000000000000DISC03",
  contentVersion: 1,
};

function composed(patch: FrameConfig): string {
  const { frame, problems } = effectiveFrame("centered", patch);
  expect(problems.filter((p) => p.severity === "error")).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: null,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

const TEXT = "We are paid by our partners.";
const TOGGLE_LOCATIONS = ["top_bar", "header", "modal"] as const;

describe("Disclosure — the link actually opens (owner 2026-08-23)", () => {
  it("is a <details>/<summary>, so a click opens it with no script at all", () => {
    const html = composed({ disclosure: { enabled: true, location: "top_bar", text: TEXT } } as never);
    expect(html).toContain('<details class="lg-disclosure-wrap"');
    expect(html).toContain('<summary class="lg-disclosure"');
    expect(html).toContain(`<div class="lg-disclosure-panel">${TEXT}</div>`);
  });

  it("the inert affordance is GONE — no hand-rolled aria-expanded, no hidden panel", () => {
    const html = composed({ disclosure: { enabled: true, location: "top_bar", text: TEXT } } as never);
    // these two together were the defect: a button that said it could expand,
    // beside a panel nothing ever un-hid.
    expect(html).not.toContain('aria-expanded="false"');
    expect(html).not.toContain('class="lg-disclosure-panel" hidden');
    expect(html).not.toContain('<button type="button" class="lg-disclosure"');
  });

  it("costs ZERO runtime bytes — the bundle still has no disclosure handler", () => {
    // WHY THIS MATTERS: the public bundle sits at 53181 of a 53248 ceiling that
    // is an owner decision (67 bytes spare). A JS toggle does not fit, which is
    // exactly why <details> is the right mechanism rather than a compromise.
    expect(LEADGEN_RUNTIME_JS).not.toContain("lg-disclosure");
    expect(LEADGEN_RUNTIME_JS.length).toBeLessThanOrEqual(53248);
  });

  // FOUND ON THE DEPLOYED PAGE, not by a test: a first cut also set
  // `display:inline` on the summary to kill the marker. That takes the summary
  // out of its list-item box and BREAKS the widget — a CLOSED disclosure still
  // laid its panel out (measured: display block, 141x43, offsetParent non-null),
  // so the legal text spilled under the link for every visitor. The CSS-text
  // assertions below all PASSED while that was true, which is exactly why this
  // leg pins the declaration that must NOT be there.
  it("the summary keeps its list-item box — a display override breaks the closed state", () => {
    const rule = CSS.match(/\.lg-disclosure\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "no display override on the summary").not.toMatch(/(^|;)display:/);
    // the wrap may be inline-block (it is the positioning anchor); the SUMMARY
    // may not be re-displayed.
    expect(CSS).toContain(".lg-disclosure-wrap{position:relative;display:inline-block}");
  });

  it("the browser's own triangle is suppressed, both ways — the label reads as it did", () => {
    const rule = CSS.match(/\.lg-disclosure\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("list-style:none");
    // a <summary> is a list-item; WebKit needs its own pseudo-element too
    expect(CSS).toContain(".lg-disclosure::-webkit-details-marker{display:none}");
    expect(CSS).toContain('.lg-disclosure::marker{content:""}');
    // the operator-visible styling it always had is untouched
    expect(rule).toContain("text-decoration:underline");
    expect(rule).toContain(`color:${defaultFunnelDesign.disclosure.color}`);
  });

  it("the panel is a POP-UP when open, and paints nothing when closed", () => {
    const open = CSS.match(/\.lg-disclosure-wrap\[open\] \.lg-disclosure-panel\{([^}]*)\}/)?.[1] ?? "";
    expect(open, "the open panel must be styled").not.toBe("");
    expect(open).toContain("position:absolute");
    expect(open).toContain(`box-shadow:${defaultFunnelDesign.shadow.lg}`);
    expect(open).toContain(`background:${defaultFunnelDesign.color.card}`);
    // it is anchored to the label rather than pushing the page down
    expect(CSS).toContain(".lg-disclosure-wrap{position:relative;display:inline-block}");
    // …and EVERY pop-up positioning rule is gated on [open], so a closed
    // disclosure paints exactly what it did before this change. (Checked as
    // "no ungated occurrence" rather than "no occurrence" — the gated rule's
    // own text ends in the same substring.)
    for (const m of CSS.matchAll(/\.lg-disclosure-panel\{position:absolute/g)) {
      const before = CSS.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
      expect(before, "an ungated absolute panel rule would paint when closed").toContain("[open]");
    }
  });
});

// OWNER 2026-08-24: "The pop-up opens, and the text appears, but below the
// section itself instead of opening on top of it."
//
// MEASURED: the panel's own z-index:30 was TRAPPED. Every .lg-frame-region is
// position:relative; z-index:1, so 30 only ordered things INSIDE the disclosure
// region — and the slot region holding the question card is a z-index:1 SIBLING
// later in the DOM, so it painted over the pop-up whatever the panel's own
// number was. A hit-test down the open panel returned `.lg-content`. The fix is
// on the REGION: a pop-up can only escape by raising the stacking context it
// lives in.
describe("Disclosure — the pop-up paints ON TOP of the page (owner 2026-08-24)", () => {
  const FRAME_CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });

  it("the panel's own z-index can never win alone — the REGION is raised", () => {
    // the trap, pinned: every region shares one layer…
    expect(FRAME_CSS).toMatch(/\.lg-frame-region\{[^}]*z-index:1[;}]/);
    // …so the two dedicated disclosure regions rise above it.
    for (const loc of ["top_bar", "modal"]) {
      const m = FRAME_CSS.match(new RegExp(`\\.lg-frame-disclosure--${loc}\\{([^}]*)\\}`));
      expect(m, `${loc} region rule`).not.toBeNull();
      expect(m![1], `${loc} region must out-stack its siblings`).toContain("z-index:41");
    }
  });

  it("the HEADER location is raised only WHILE OPEN — a sticky header must not out-stack the page forever", () => {
    expect(FRAME_CSS).toContain(
      `${DEFAULT_FUNNEL_SCOPE} .lg-frame-region:has(details.lg-disclosure-wrap[open]){z-index:41}`,
    );
  });

  it("the anchored popover stays inside the viewport — max-width means the WHOLE box", () => {
    const rule = CSS.match(/\.lg-disclosure-wrap\[open\] \.lg-disclosure-panel\{([^}]*)\}/)?.[1] ?? "";
    // MEASURED at 414px without this: 380.88 content + 16px padding + 1px border
    // each side rendered a 415px popover — wider than the viewport.
    expect(rule).toContain("box-sizing:border-box");
    expect(rule).toContain("max-width:min(92vw, 420px)");
  });

  it("the CENTRED pop-up location keeps its own viewport-centred shape", () => {
    // MEASURED before this: the base anchored-popover rule (2 classes + attr)
    // out-ranked the modal arm (2 classes), so "Centred pop-up" resolved to
    // position:absolute and stopped centring. The modal arm carries [open] so it
    // wins on its own turf regardless of sheet order.
    const m = FRAME_CSS.match(
      /\.lg-frame-disclosure--modal \.lg-disclosure-wrap\[open\] \.lg-disclosure-panel\{([^}]*)\}/,
    );
    expect(m, "the modal arm must carry [open]").not.toBeNull();
    expect(m![1]).toContain("position:fixed");
    expect(m![1]).toContain("transform:translate(-50%,-50%)");
  });
});

describe("Disclosure — no text, no link (the other half of 'it's not working')", () => {
  it("every toggle location refuses to render a link with nothing behind it", () => {
    for (const location of TOGGLE_LOCATIONS) {
      const empty = composed({ disclosure: { enabled: true, location, text: "" } } as never);
      expect(empty, `${location}: empty text renders no link`).not.toContain("lg-disclosure-wrap");
      const blank = composed({ disclosure: { enabled: true, location, text: "   " } } as never);
      expect(blank, `${location}: whitespace-only text renders no link`).not.toContain("lg-disclosure-wrap");
      const withText = composed({ disclosure: { enabled: true, location, text: TEXT } } as never);
      expect(withText, `${location}: authored text renders the link`).toContain("lg-disclosure-wrap");
    }
  });

  it("the footer leg is unchanged — it always required text, and it is inline copy not a link", () => {
    const footer = composed({ disclosure: { enabled: true, location: "footer", text: TEXT } } as never);
    expect(footer).toContain(`<div class="lg-frame-footer-disclosure" data-frame-region="disclosure">${TEXT}</div>`);
    expect(footer).not.toContain("lg-disclosure-wrap");
    expect(composed({ disclosure: { enabled: true, location: "footer", text: "" } } as never)).not.toContain(
      "lg-frame-footer-disclosure",
    );
  });

  it("the independent header link (header.disclosure_link) obeys the same guard", () => {
    const on = composed({
      header: { enabled: true, disclosure_link: true },
      disclosure: { enabled: true, location: "footer", text: TEXT },
    } as never);
    expect(on).toContain("lg-frame-header-disclosure");
    const noText = composed({
      header: { enabled: true, disclosure_link: true },
      disclosure: { enabled: true, location: "footer", text: "" },
    } as never);
    expect(noText).not.toContain("lg-frame-header-disclosure");
  });
});

describe("Disclosure — applied only if activated (owner 2026-08-23)", () => {
  it("enabled:false renders nothing at ANY location, even with text authored", () => {
    for (const location of [...TOGGLE_LOCATIONS, "footer"] as const) {
      const off = composed({ disclosure: { enabled: false, location, text: TEXT } } as never);
      expect(off, `${location}: off renders no link`).not.toContain("lg-disclosure-wrap");
      expect(off, `${location}: off renders no footer copy`).not.toContain("lg-frame-footer-disclosure");
      expect(off, `${location}: off renders no disclosure region`).not.toContain('data-frame-region="disclosure"');
    }
  });

  it("the ON/OFF switch exists in panel D — the one piece that was missing", () => {
    const panel = renderTemplatesTabPanel(true, []);
    const at = panel.indexOf('data-tplbox-panel="disclosure"');
    expect(at, "the D panel must render").toBeGreaterThan(-1);
    const d = panel.slice(at, panel.indexOf('data-tplbox-add="disclosure.entries"', at));
    expect(d).toContain('data-frame-key="disclosure.enabled"');
    expect(d).toContain("Show the disclosure");
    // …and it is a checkbox, like the footer's own "Show the footer"
    expect(d).toMatch(/<input[^>]*type="checkbox"[^>]*data-frame-key="disclosure\.enabled"/);
  });

  it("panel D also offers the text, the label and the location it never had", () => {
    const panel = renderTemplatesTabPanel(true, []);
    const at = panel.indexOf('data-tplbox-panel="disclosure"');
    const d = panel.slice(at, panel.indexOf('data-tplbox-add="disclosure.entries"', at));
    // the text is a PARAGRAPH field — it is a legal notice, not a label
    expect(d).toMatch(/<textarea[^>]*data-frame-key="disclosure\.text"/);
    expect(d).toContain('data-frame-key="disclosure.link_label"');
    expect(d).toContain('data-frame-key="disclosure.location"');
    // the four locations in the operator's words, never the storage key
    for (const label of ["Bar above the header", "In the header", "In the footer (plain text)", "Centred pop-up"]) {
      expect(d, label).toContain(label);
    }
    expect(d).not.toContain(">top_bar<");
    // and the help line states the rule the renderer enforces
    expect(d).toContain("Without it there is nothing to open, so no link is shown.");
  });
});

describe("Disclosure — the v2 entries list still works beside the legacy fields", () => {
  const THEMES_FILE = join(dirname(fileURLToPath(import.meta.url)), "../src/admin/leadgen/quotes-tabs/templates.ts");

  it("panel D keeps its per-location entries list and its add button", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).toContain('data-tplbox-list="disclosure.entries"');
    expect(panel).toContain('data-tplbox-add="disclosure.entries"');
    // the legacy fields sit ABOVE the entries list, so the panel reads top-down
    const at = panel.indexOf('data-tplbox-panel="disclosure"');
    const enabledAt = panel.indexOf('data-frame-key="disclosure.enabled"', at);
    const entriesAt = panel.indexOf('data-tplbox-list="disclosure.entries"', at);
    expect(enabledAt).toBeGreaterThan(-1);
    expect(enabledAt).toBeLessThan(entriesAt);
  });

  it("a v2 entry still renders its own hover/full tooltip markup, untouched", () => {
    const html = composed({
      disclosure: {
        enabled: true,
        location: "footer",
        text: TEXT,
        entries: [{ location: "top", mode: "hover", text: "Entry copy" }],
      },
    } as never);
    expect(html).toContain("lg-frame-disc2-region");
    expect(readFileSync(THEMES_FILE, "utf8")).toContain("disclosure.entries");
  });
});
