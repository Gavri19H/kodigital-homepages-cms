// Listicles Phase 4 — the governed block grammar, server side (§12 + §30.5).
//
// Pins: every governed anchor emits data-offer + data-link-instance +
// data-block-id + data-link-role and rel="sponsored nofollow noopener" and
// NO href (no /lc URL is stored — §12); list markers (disc/dash/ordered/
// check/emoji); curated colour tokens only; sanitizer round-trips (hostile
// payloads neutralized through the L-054/L-070 pipeline); §30.5 reference
// presets each carry a layout_binding; plain legacy-shaped blocks delegate
// BYTE-IDENTICALLY to the existing renderer (pillar 1).

import { describe, expect, it } from "vitest";
import {
  GOVERNED_LINK_REL,
  governInlineHtml,
  LISTICLE_EMOJI_SET,
  LISTICLE_HIGHLIGHTS,
  LISTICLE_LIST_MARKERS,
  LISTICLE_REFERENCE_PRESETS,
  LISTICLE_TEXT_COLORS,
  listicleBlocksToHtml,
  renderListicleBlock,
} from "../src/editor/listicle-blocks";
import { renderBlock } from "../src/editor/blocks";
import { defaultListicleLayoutTokens } from "../src/public/listicle/layouts/default/tokens";

const GOVERNED_ATTRS = ["data-offer=", "data-link-instance=", "data-block-id=", "data-link-role="];

function expectGoverned(html: string, role: string): void {
  for (const attr of GOVERNED_ATTRS) {
    expect(html).toContain(attr);
  }
  expect(html).toContain(`data-link-role="${role}"`);
  expect(html).toContain(`rel="${GOVERNED_LINK_REL}"`);
  // §12: NO href is stored — the live renderer mints /lc URLs at render time.
  expect(html).not.toMatch(/\bhref\s*=/i);
  expect(html).not.toContain("/lc/");
}

describe("listicle block renderers — governed anchors (§12/§30.7)", () => {
  it("button: full attribute bundle, style + align, no href", () => {
    const html = renderListicleBlock({
      id: "b1",
      type: "button",
      data: {
        text: "Get the deal",
        style: "primary",
        align: "left",
        offer_id: "off_ABC",
        link_instance_id: "lnk_X1",
      },
    });
    expectGoverned(html, "button");
    expect(html).toContain('data-offer="off_ABC"');
    expect(html).toContain('data-link-instance="lnk_X1"');
    expect(html).toContain('data-block-id="b1"');
    expect(html).toContain('data-btn-style="primary"');
    expect(html).toContain('data-align="left"');
    expect(html).toContain(">Get the deal</a>");
  });

  it("choice_button_group: prompt + one governed anchor per item (§30.5 shape)", () => {
    const html = renderListicleBlock({
      id: "g1",
      type: "choice_button_group",
      data: {
        layout_binding: "default.choiceButtonGroup",
        prompt: "What state do you live in?",
        items: [
          {
            id: "i1",
            link_instance_id: "lnk_1",
            text: "California",
            offer_id: "off_A",
            style_id: "reference-choice-button",
            layout_binding: "default.choiceButton",
          },
          {
            id: "i2",
            link_instance_id: "lnk_2",
            text: "Texas",
            offer_id: "off_B",
            style_id: "reference-choice-button",
            layout_binding: "default.choiceButton",
            analytics_label: "state-tx",
          },
        ],
      },
    });
    expectGoverned(html, "choice_button");
    expect(html).toContain("What state do you live in?");
    expect((html.match(/<a /g) ?? []).length).toBe(2);
    expect(html).toContain('data-btn-style="reference-choice-button"');
    expect(html).toContain('data-analytics-label="state-tx"');
    expect(html).toContain('data-lst-binding="default.choiceButtonGroup"');
    // Every anchor shares the GROUP's block id (§30.7 button_group_id ≡ block).
    expect((html.match(/data-block-id="g1"/g) ?? []).length).toBe(3); // group div + 2 anchors
  });

  it("final_text_cta: governed text link (§30.5 shape)", () => {
    const html = renderListicleBlock({
      id: "f1",
      type: "final_text_cta",
      data: {
        link_instance_id: "lnk_9",
        text: "See if you qualify today",
        offer_id: "off_Z",
        layout_binding: "default.textCta",
      },
    });
    expectGoverned(html, "final_text_cta");
    expect(html).toContain("lst-final-cta");
    expect(html).toContain(">See if you qualify today</a>");
  });

  it("linked_image: governed <a><img></a>, lazy loading, alt", () => {
    const html = renderListicleBlock({
      id: "img1",
      type: "linked_image",
      data: {
        image_url: "/media/uploads/pic.jpg",
        alt: "A cozy home",
        offer_id: "off_I",
        link_instance_id: "lnk_I",
        layout_binding: "default.sectionImage",
      },
    });
    expectGoverned(html, "linked_image");
    expect(html).toContain('src="/media/uploads/pic.jpg"');
    expect(html).toContain('alt="A cozy home"');
    expect(html).toContain('loading="lazy"');
  });

  it("linked_image: unsafe src is dropped entirely", () => {
    const html = renderListicleBlock({
      id: "img2",
      type: "linked_image",
      data: { image_url: "javascript:alert(1)", alt: "x", offer_id: "off_I", link_instance_id: "lnk" },
    });
    expect(html).toBe("");
  });

  it("inline offerlink mark: governed via the inline pass; ungoverned anchors unwrap", () => {
    const html = renderListicleBlock({
      id: "p1",
      type: "paragraph",
      data: {
        text: "Check this offer now",
        html: 'Check <a data-offer="off_L" data-link-instance="lnk_L">this offer</a> now — <a href="https://leak.example">evil</a>',
      },
    });
    expectGoverned(html, "inline");
    expect(html).toContain('data-offer="off_L"');
    expect(html).toContain('data-link-instance="lnk_L"');
    // The ungoverned anchor is unwrapped: its text survives, the tag does not.
    expect(html).toContain("evil");
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });

  it("linked section heading: heading with offer wraps its text in a governed inline anchor", () => {
    const html = renderListicleBlock({
      id: "h1",
      type: "heading",
      data: {
        level: 2,
        text: "1. Senior Savings Program",
        offer_id: "off_H",
        link_instance_id: "lnk_H",
        layout_binding: "default.sectionHeading",
      },
    });
    expectGoverned(html, "inline");
    expect(html).toMatch(/^<h2/);
    expect(html).toContain(">1. Senior Savings Program</a>");
  });
});

describe("listicle list markers (§12)", () => {
  it("check list renders the §30.1 checkmark marker glyph", () => {
    const html = renderListicleBlock({
      id: "l1",
      type: "list",
      data: { style: "unordered", marker: "check", items: ["No fees", "Fast"] },
    });
    expect(html).toContain('data-marker="check"');
    expect(html).toContain(defaultListicleLayoutTokens.listBlock.checkmarkMarker.trim());
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });

  it("emoji list renders the curated emoji as the item marker", () => {
    const emoji = LISTICLE_EMOJI_SET[0] as string;
    const html = renderListicleBlock({
      id: "l2",
      type: "list",
      data: { style: "unordered", marker: "emoji", emoji, items: ["Point one"] },
    });
    expect(html).toContain('data-marker="emoji"');
    expect(html).toContain(emoji);
  });

  it("ordered marker renders an <ol> without marker spans; dash renders a dash", () => {
    const ordered = renderListicleBlock({
      id: "l3",
      type: "list",
      data: { marker: "ordered", items: ["a", "b"] },
    });
    expect(ordered).toMatch(/^<ol/);
    expect(ordered).not.toContain("lst-marker");
    const dash = renderListicleBlock({
      id: "l4",
      type: "list",
      data: { marker: "dash", items: ["a"] },
    });
    expect(dash).toContain("– ");
  });

  it("the marker vocabulary is exactly §12's", () => {
    expect([...LISTICLE_LIST_MARKERS]).toEqual(["disc", "dash", "ordered", "check", "emoji"]);
  });
});

describe("curated colour tokens (§12)", () => {
  it("text colours derive from the §30.1 token package", () => {
    expect(LISTICLE_TEXT_COLORS.body).toBe(defaultListicleLayoutTokens.page.textColor);
    expect(LISTICLE_TEXT_COLORS.brand).toBe(defaultListicleLayoutTokens.inlineLink.color);
    expect(LISTICLE_TEXT_COLORS.brandDark).toBe(defaultListicleLayoutTokens.inlineLink.hoverColor);
    expect(LISTICLE_TEXT_COLORS.muted).toBe(defaultListicleLayoutTokens.byline.color);
    expect(LISTICLE_HIGHLIGHTS.brandTint).toBe(
      defaultListicleLayoutTokens.header.borderBottomColor,
    );
  });

  it("curated colour spans survive; unknown colour tokens are dropped", () => {
    const html = governInlineHtml(
      '<span data-lst-color="brand">red</span> <span data-lst-color="hotpink">nope</span> <span data-lst-highlight="sun">hi</span>',
      { blockId: "p" },
    );
    expect(html).toContain('<span data-lst-color="brand">red</span>');
    expect(html).toContain('<span data-lst-highlight="sun">hi</span>');
    expect(html).toContain("<span>nope</span>");
    expect(html).not.toContain("hotpink");
  });
});

describe("sanitizer round-trip (§24 content safety)", () => {
  it("hostile payloads are neutralized through the existing L-054/L-070 pipeline", () => {
    const html = governInlineHtml(
      '<script>alert(1)</script><b onmouseover="x()">bold</b><a data-offer="off_1" href="javascript:evil()">go</a><img src="x" onerror="p()">',
      { blockId: "p" },
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onmouseover");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    // The governed anchor survives WITHOUT the href.
    expect(html).toContain('data-offer="off_1"');
    expect(html).not.toMatch(/\bhref\s*=/i);
    // Non-inline tags (img) are unwrapped.
    expect(html).not.toContain("<img");
  });

  it("governed output is stable under a second pass (idempotent)", () => {
    const once = governInlineHtml(
      'Try <a data-offer="off_2" data-link-instance="lnk_2">this</a> <span data-lst-color="brand">now</span>',
      { blockId: "p" },
    );
    const twice = governInlineHtml(once, { blockId: "p" });
    expect(twice).toBe(once);
  });

  it("text content in governed blocks is HTML-escaped", () => {
    const html = renderListicleBlock({
      id: "b",
      type: "button",
      data: { text: '<script>x</script>&"', offer_id: "off_1", link_instance_id: "l" },
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("pillar 1 — legacy-shaped blocks delegate byte-identically", () => {
  const plainBlocks = [
    { type: "paragraph", data: { text: "plain text" } },
    { type: "heading", data: { level: 2, text: "a heading" } },
    { type: "list", data: { style: "ordered", items: ["one", "two"] } },
    { type: "quote", data: { text: "q", cite: "c" } },
    { type: "divider", data: {} },
    { type: "callout", data: { title: "T", text: "body" } },
  ];
  for (const block of plainBlocks) {
    it(`${block.type}: identical to the existing renderer`, () => {
      expect(renderListicleBlock(block, 0)).toBe(renderBlock(block));
    });
  }

  it("the legacy affiliate block renders nothing extra through the listicle path (delegates)", () => {
    const block = {
      type: "affiliate",
      data: { title: "t", url: "https://x.example", description: "d" },
    };
    expect(renderListicleBlock(block, 0)).toBe(renderBlock(block));
  });
});

describe("§30.5 reference presets", () => {
  it("all 17 presets are registered, each carrying its layout_binding", () => {
    expect(LISTICLE_REFERENCE_PRESETS).toHaveLength(17);
    for (const preset of LISTICLE_REFERENCE_PRESETS) {
      expect(preset.layout_binding, preset.key).toMatch(/^default\./);
      expect(preset.label, preset.key).toMatch(/^Reference /);
      expect(preset.block.type.length, preset.key).toBeGreaterThan(0);
    }
  });

  it("the preset labels match the §30.5 list exactly", () => {
    expect(LISTICLE_REFERENCE_PRESETS.map((p) => p.label)).toEqual([
      "Reference Section Heading",
      "Reference Linked Section Heading",
      "Reference Linked Image",
      "Reference Paragraph",
      "Reference Strong Text",
      "Reference Inline Offer Link",
      "Reference Qualification Heading",
      "Reference Step Text",
      "Reference Question Prompt",
      "Reference Choice Button Group",
      "Reference Choice Button",
      "Reference Checkmark List",
      "Reference Bullet List",
      "Reference Disclaimer Paragraph",
      "Reference Final Text CTA",
      "Reference Legal Disclosure",
      "Reference Spacer / Gap",
    ]);
  });

  it("choice group / final CTA / linked image presets carry the exact §30.5 data keys", () => {
    const byKey = new Map(LISTICLE_REFERENCE_PRESETS.map((p) => [p.key, p]));
    const group = byKey.get("reference-choice-button-group");
    expect(group?.block.type).toBe("choice_button_group");
    expect(Object.keys(group?.block.data ?? {}).sort()).toEqual(
      ["items", "layout_binding", "prompt"],
    );
    expect(group?.block.data.layout_binding).toBe("default.choiceButtonGroup");

    const item = byKey.get("reference-choice-button");
    expect(item?.block.data.style_id).toBe("reference-choice-button");
    expect(item?.block.data.layout_binding).toBe("default.choiceButton");
    expect(item?.block.data).toHaveProperty("link_instance_id");

    const cta = byKey.get("reference-final-text-cta");
    expect(cta?.block.type).toBe("final_text_cta");
    expect(Object.keys(cta?.block.data ?? {}).sort()).toEqual(
      ["layout_binding", "link_instance_id", "offer_id", "text"],
    );
    expect(cta?.block.data.layout_binding).toBe("default.textCta");

    const img = byKey.get("reference-linked-image");
    expect(img?.block.type).toBe("linked_image");
    expect(Object.keys(img?.block.data ?? {}).sort()).toEqual(
      ["alt", "image_url", "layout_binding", "link_instance_id", "offer_id"],
    );
    expect(img?.block.data.layout_binding).toBe("default.sectionImage");
  });
});

describe("document rendering", () => {
  it("renders a whole document and skips empty governed blocks", () => {
    const html = listicleBlocksToHtml({
      blocks: [
        { id: "p", type: "paragraph", data: { text: "hello" } },
        { id: "b", type: "button", data: { text: "", offer_id: "off_1" } }, // no text → empty
        { id: "s", type: "spacer", data: {} },
      ],
    });
    expect(html).toContain("<p>hello</p>");
    expect(html).not.toContain("lst-btn-row");
    expect(html).toContain("lst-spacer");
  });

  it("accepts a JSON string document and returns '' for malformed input", () => {
    expect(listicleBlocksToHtml('{"blocks":[{"type":"paragraph","data":{"text":"x"}}]}')).toBe(
      "<p>x</p>",
    );
    expect(listicleBlocksToHtml("not json")).toBe("");
    expect(listicleBlocksToHtml(null)).toBe("");
  });
});
