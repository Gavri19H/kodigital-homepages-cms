// OWNER 2026-08-23, element J (Quotes → Templates → Page Footer → Footer (J)):
//   1. "Spacing between blocks - Right now, some of the blocks sit really
//      tight, and it looks weird. The user should be able to increase /
//      decrease the spacing between blocks"
//   2. "Add the ability to use dividers between blocks similar to the one
//      appearing in the attached screenshot"
//
// FAIL-BEFORE, measured in a browser against the REAL renderer + REAL sheet
// (his reference footer's block anatomy, 1280px): the gaps between the ten
// blocks were 8 / 16 / 4 / 0 / 0 px — five different values coming from eight
// independent hardcoded per-block margins, with logo→socials and
// socials→socials TOUCHING at 0px. There was no spacing control and no divider
// block type at all.
//
// AFTER: one gap axis, uniform at every step (xs 4 · s 8 · m 16 default · l 24
// · xl 32), and a Divider line block the operator places between any two
// blocks. Driven proof at 1280 + 375 (E6) — dividers span the content band,
// no page overflow, gaps uniform at both widths.
import { describe, expect, it } from "vitest";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { FRAME_FOOTER_BLOCK_GAPS, effectiveFrame, validateFrameConfig } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";
import { runInNewContext } from "node:vm";

const TOKENS = resolveTokens(defaultFunnelDesign);
const CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
const ROOT = {
  funnelId: "lgf_0000000000000000000FOOT01",
  funnelVariantId: "lgn_0000000000000000000FOOT02",
  quoteId: "lgq_0000000000000000000FOOT03",
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

// His reference footer's shape (Screenshot 2026-08-23 at 18.27.46): legal
// paragraphs, a DIVIDER, the legal-page links, a DIVIDER, then the advertising
// disclosure.
const HIS_SHAPE: Record<string, unknown>[] = [
  { type: "about_paragraph", align: "left", text: "Reproduction in whole or in part is strictly prohibited." },
  { type: "divider" },
  { type: "heading", align: "left", level: 4, html: "About Us" },
  { type: "heading", align: "left", level: 4, html: "Sitemap" },
  { type: "divider" },
  { type: "heading", align: "left", level: 4, html: "Don't Sell My Personal Information" },
  { type: "disclosure", align: "left", text: "This site is a free online resource." },
];

// ---------------------------------------------------------------------------
// (2) the divider block
// ---------------------------------------------------------------------------

describe("element J — a Divider line block between footer blocks (owner 2026-08-23)", () => {
  it("renders an <hr> exactly where the operator placed it, in order", () => {
    const html = composed({ footer: { enabled: true, blocks: HIS_SHAPE } } as never);
    expect(html).toContain('<hr class="lg-frame-footer2-divider">');
    // TWO dividers, in his two positions — after the paragraph and after
    // "Sitemap", never re-ordered or collapsed.
    const footer = html.slice(html.indexOf("lg-frame-footer2"));
    const order = [...footer.matchAll(/lg-frame-footer2-(divider|about|heading|disclosure)/g)].map((m) => m[1]);
    expect(order).toEqual(["about", "divider", "heading", "heading", "divider", "heading", "disclosure"]);
  });

  it("an <hr> is the element that MEANS a separation — not a styled empty div", () => {
    const html = composed({ footer: { enabled: true, blocks: [{ type: "divider" }] } as never } as never);
    expect(html).toMatch(/<hr class="lg-frame-footer2-divider">/);
    expect(html).not.toContain('<div class="lg-frame-footer2-divider"');
  });

  it("carries NO fields — no align attribute to store and never read (the dead-control class)", () => {
    // Even when a stale/hand-written config supplies one, the render ignores it.
    const html = composed({ footer: { enabled: true, blocks: [{ type: "divider", align: "right" }] } as never } as never);
    expect(html).toContain('<hr class="lg-frame-footer2-divider">');
    expect(html).not.toMatch(/lg-frame-footer2-divider"[^>]*data-align/);
  });

  it("the rule takes the footer's OWN colour, so it lands on any background with no colour control", () => {
    const m = CSS.match(/\.lg-frame-footer2-divider\{([^}]*)\}/);
    expect(m, "the divider must be styled").not.toBeNull();
    const decls = m![1]!;
    expect(decls).toContain("border-top:1px solid currentColor");
    expect(decls).toContain("opacity:0.25");
    expect(decls).toContain("width:100%");
    // border:0 FIRST, or the UA's default 3D groove survives on the other sides.
    expect(decls.indexOf("border:0")).toBe(0);
  });

  it("validates as a complete block with nothing else set, and the type list names it in plain words", () => {
    const ok = validateFrameConfig({ footer: { enabled: true, blocks: [{ type: "divider" }] } } as never);
    expect(ok.problems.filter((p) => p.severity === "error")).toEqual([]);
    const bad = validateFrameConfig({ footer: { enabled: true, blocks: [{ type: "hr" }] } } as never);
    const err = bad.problems.find((p) => p.severity === "error" && p.path.includes("type"));
    expect(err, "an unknown type must still be rejected").toBeDefined();
    expect(err!.message).toContain("Divider line");
  });

  it("is absent byte-for-byte from a footer that never authors one", () => {
    const html = composed({ footer: { enabled: true, blocks: [{ type: "about_paragraph", text: "x" }] } } as never);
    expect(html).not.toContain("lg-frame-footer2-divider");
    expect(html).not.toContain("<hr");
  });
});

// ---------------------------------------------------------------------------
// (1) the spacing axis
// ---------------------------------------------------------------------------

describe("element J — one spacing axis for every gap between footer blocks (owner 2026-08-23)", () => {
  it("ONE gap owns the stack, and every child's own margin is zeroed so nothing double-spaces", () => {
    const gap = CSS.match(/\.lg-frame-footer2--blocks\{([^}]*)\}/);
    expect(gap, "the blocks stack must be styled").not.toBeNull();
    expect(gap![1]!).toContain("display:flex");
    expect(gap![1]!).toContain("flex-direction:column");
    // The default is the WIDEST gap the old per-block margins produced (16px),
    // so no authored footer gets tighter than it was.
    expect(gap![1]!).toContain("gap:var(--lg-footer-block-gap,1rem)");
  });

  it("the margin-zeroing rule outranks every per-block margin ON SPECIFICITY, not on source order", () => {
    // FAIL-BEFORE of this very rule: a one-class selector tied with
    // .lg-frame-footer2-heading and lost on order — measured 24/32/36 instead
    // of a uniform 16. Two classes win wherever the rule is emitted.
    const zero = CSS.match(/\.lg-frame-footer2--blocks\.lg-frame-footer2 > \*\{([^}]*)\}/);
    expect(zero, "the child margin reset must carry BOTH classes").not.toBeNull();
    expect(zero![1]!).toContain("margin:0");
    // Every per-block margin rule it has to beat is a single class — proving
    // the reset can never be the weaker selector.
    for (const cls of ["about", "address", "disclosure", "links", "heading", "list"]) {
      const perBlock = CSS.match(new RegExp(`\\.lg-frame-footer2-${cls}\\{([^}]*)\\}`));
      if (perBlock !== null && /margin/.test(perBlock[1]!)) {
        expect(
          CSS,
          `.lg-frame-footer2-${cls} carries a margin, so the reset must be the 2-class selector`,
        ).toContain(".lg-frame-footer2--blocks.lg-frame-footer2 > *{margin:0}");
      }
    }
  });

  it("the logo block's INNER margins are zeroed too — a child-level reset can't reach them", () => {
    // Measured: .lg-frame-footer-logo (margin:1rem auto 0) and
    // .lg-frame-footer-logo-text (margin-top:1rem) put 32px above a logo block
    // while every other gap was 16 — one block ignoring the operator's choice.
    const m = CSS.match(
      /\.lg-frame-footer2--blocks \.lg-frame-footer-logo,[^{]*\.lg-frame-footer2--blocks \.lg-frame-footer-logo-text\{([^}]*)\}/,
    );
    expect(m, "the logo block's inner margins must be zeroed in blocks mode").not.toBeNull();
    expect(m![1]!).toContain("margin:0");
    // …and the same `auto`/centre hardcoding was why a logo block ignored its
    // own Alignment dropdown. Inheriting hands that control back.
    expect(m![1]!).toContain("text-align:inherit");
    // BLOCKS MODE ONLY: the legacy footer keeps its own margins untouched.
    expect(CSS).toContain(".lg-frame-footer-logo-text{display:block;text-align:center;margin-top:1rem");
  });

  it("declares all five steps as the design's own spacing tokens, so the picker can't drift from the scale", () => {
    const base = CSS.match(/\.lg-frame-footer2\{([^}]*)\}/);
    expect(base).not.toBeNull();
    const decls = base![1]!;
    const expected: Record<string, string> = { xs: "0.25rem", s: "0.5rem", m: "1rem", l: "1.5rem", xl: "2rem" };
    for (const step of FRAME_FOOTER_BLOCK_GAPS) {
      expect(decls, `--lg-footer-gap-${step} must be declared`).toContain(`--lg-footer-gap-${step}:${expected[step]}`);
    }
    // No arbitrary lengths: every step is a token value from the design.
    expect(Object.keys(expected).sort()).toEqual([...FRAME_FOOTER_BLOCK_GAPS].sort());
  });

  it("each step emits a var() REFERENCE to that token — never a length the renderer computed", () => {
    for (const step of FRAME_FOOTER_BLOCK_GAPS) {
      const html = composed({
        footer: { enabled: true, blocks: [{ type: "about_paragraph", text: "x" }], block_gap: step },
      } as never);
      expect(html).toContain(`--lg-footer-block-gap:var(--lg-footer-gap-${step})`);
      // the authored token never reaches CSS as a raw value
      expect(html).not.toMatch(/--lg-footer-block-gap:[0-9]/);
    }
  });

  it("validates the five steps and refuses anything else (never an arbitrary CSS length)", () => {
    for (const step of FRAME_FOOTER_BLOCK_GAPS) {
      const ok = validateFrameConfig({ footer: { enabled: true, block_gap: step } } as never);
      expect(ok.problems.filter((p) => p.severity === "error"), `${step} must validate`).toEqual([]);
    }
    for (const bad of ["2rem", "huge", "0", "calc(1rem + 2px)"]) {
      const res = validateFrameConfig({ footer: { enabled: true, block_gap: bad } } as never);
      expect(
        res.problems.some((p) => p.severity === "error" && p.path.includes("block_gap")),
        `${bad} must be refused`,
      ).toBe(true);
    }
  });

  it("an unset gap emits NO custom property — the sheet's own default applies", () => {
    const html = composed({ footer: { enabled: true, blocks: [{ type: "about_paragraph", text: "x" }] } } as never);
    expect(html).not.toContain("--lg-footer-block-gap");
  });
});

// ---------------------------------------------------------------------------
// byte-safety: the legacy footer composition is untouched
// ---------------------------------------------------------------------------

describe("element J — the block-spacing stack applies to the BLOCK model only", () => {
  it("the stack class rides authored blocks; a legacy footer renders exactly as before", () => {
    const withBlocks = composed({ footer: { enabled: true, blocks: [{ type: "about_paragraph", text: "x" }] } } as never);
    expect(withBlocks).toContain("lg-frame-footer2--blocks");

    // No blocks authored → the B3 content-preservation path composes the legacy
    // trust/links/logo bar in this same wrapper, and that composition owns its
    // own spacing. It must NOT be re-stacked.
    const noBlocks = composed({ footer: { enabled: true, palette_scope: { text: "text_primary" } } } as never);
    expect(noBlocks).toContain("lg-frame-footer2");
    expect(noBlocks).not.toContain("lg-frame-footer2--blocks");

    // …and an emptied-out block list is still the legacy path, not a bare band.
    const emptied = composed({ footer: { enabled: true, blocks: [] } } as never);
    expect(emptied).not.toContain("lg-frame-footer2--blocks");
  });
});

// ---------------------------------------------------------------------------
// the operator's own controls
// ---------------------------------------------------------------------------

describe("element J panel — the two controls the owner asked for exist and are wired", () => {
  const PANEL = renderTemplatesTabPanel(true, []);

  it("the footer panel offers the spacing picker with all five steps", () => {
    const at = PANEL.indexOf('data-tplbox-panel="footer"');
    expect(at, "the J panel must render").toBeGreaterThan(-1);
    const panel = PANEL.slice(at, PANEL.indexOf("</div>", PANEL.indexOf('data-tplbox-add="footer.blocks"')));
    expect(panel).toContain("Spacing between blocks");
    expect(panel).toContain('data-frame-key="footer.block_gap"');
    for (const [value, label] of [
      ["xs", "Extra small"],
      ["s", "Small"],
      ["m", "Medium"],
      ["l", "Large"],
      ["xl", "Extra large"],
    ]) {
      expect(panel, `${value} option`).toContain(`value="${value}">${label}<`);
    }
  });

  it("Divider line is offered in the block-type picker, in the operator's words", () => {
    expect(PANEL).toContain('value="divider">Divider line<');
    // plain words only — never the storage key at a person
    expect(PANEL).not.toContain(">divider<");
  });
});

describe("element J island — a divider row shows only what a divider has (owner 2026-08-23)", () => {
  function loadFooterBlockTypeChanged(): (row: unknown) => void {
    const start = QUOTE_EDITOR_SCRIPT.indexOf("function footerBlockTypeChanged(blockRow) {");
    expect(start, "footerBlockTypeChanged must exist in the shipped island").toBeGreaterThan(-1);
    const end = QUOTE_EDITOR_SCRIPT.indexOf("\n  }", start) + 4;
    return runInNewContext(`${QUOTE_EDITOR_SCRIPT.slice(start, end)}; footerBlockTypeChanged;`, {}) as (
      row: unknown,
    ) => void;
  }

  interface StubEl {
    className: string;
    value?: string;
  }
  function stubRow(type: string): { row: unknown; els: Record<string, StubEl> } {
    const els: Record<string, StubEl> = {
      "[data-footer-block-type]": { className: "", value: type },
      "[data-footer-block-align]": { className: "form-select form-select-sm" },
      "[data-footer-block-text]": { className: "form-input" },
      "[data-footer-block-linkrow]": { className: "lg-hidden" },
      "[data-footer-block-items]": { className: "form-input lg-hidden" },
      "[data-footer-block-liststyle]": { className: "form-select form-select-sm lg-hidden" },
      "[data-footer-block-logo]": { className: "lg-hidden" },
      "[data-footer-block-toolbar]": { className: "lg-tplbox-toolbar" },
      "[data-footer-block-level]": { className: "form-select form-select-sm lg-hidden" },
    };
    return { row: { querySelector: (sel: string) => els[sel] ?? null }, els };
  }
  const shown = (el: StubEl): boolean => el.className.indexOf("lg-hidden") === -1;

  it("a divider row hides every field, alignment included; every other type keeps its Alignment", () => {
    const fn = loadFooterBlockTypeChanged();
    const { row, els } = stubRow("divider");
    fn(row);
    for (const sel of [
      "[data-footer-block-align]",
      "[data-footer-block-text]",
      "[data-footer-block-linkrow]",
      "[data-footer-block-items]",
      "[data-footer-block-liststyle]",
      "[data-footer-block-logo]",
      "[data-footer-block-toolbar]",
      "[data-footer-block-level]",
    ]) {
      expect(shown(els[sel]!), `divider: ${sel} must be hidden`).toBe(false);
    }
    for (const type of ["about_paragraph", "link_row", "disclosure", "logo", "address", "socials", "heading", "list"]) {
      const other = stubRow(type);
      fn(other.row);
      expect(shown(other.els["[data-footer-block-align]"]!), `${type}: Alignment must stay visible`).toBe(true);
    }
  });

  it("the collector stores a divider as type-only, and never drops it as an empty block", () => {
    const start = QUOTE_EDITOR_SCRIPT.indexOf("function collectFooterBlocksRaw() {");
    expect(start, "collectFooterBlocksRaw must exist in the shipped island").toBeGreaterThan(-1);
    // The two shipped literals that make it so — the type-only push, and the
    // fact that it happens BEFORE the empty-text skip could reach it.
    const src = QUOTE_EDITOR_SCRIPT.slice(start, start + 4000);
    expect(src).toContain("if (type === 'divider') { out.push({ type: 'divider' }); continue; }");
    expect(src.indexOf("if (type === 'divider')")).toBeGreaterThan(src.indexOf("renders nothing — skip it"));
    expect(src.indexOf("if (type === 'divider')")).toBeLessThan(src.indexOf("var block = { type: type, align: align };"));
  });
});
