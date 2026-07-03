// Listicles Phase 4 — link-instance extraction + enrichment (§30.5/§30.7).
//
// The extractor picks up every governed element of the Phase-4 grammar
// (choice_button_group items, final_text_cta, linked_image, linked headings,
// inline offerlinks in html AND string list items); `applyLinkInstances`
// mirrors the SAME walk and stamps resolved lnk_… ids back into the document
// (extract → resolve → apply → re-extract lines up 1:1); lnk_ public ids stay
// stable across enriched re-saves (the Phase-2 placement-key reuse contract).

import { describe, expect, it } from "vitest";
import {
  aggregateSectionOffers,
  applyLinkInstances,
  extractLinkInstances,
  resolveLinkInstances,
  type ExistingLinkInstanceRow,
  type SectionLinkSource,
} from "../src/listicles/link-instances";
import type { SectionBlock } from "../src/listicles/validation";

function source(blocks: SectionBlock[], headlineOffer: number | null = null): SectionLinkSource {
  return { headline_text: "Headline", headline_offer_id: headlineOffer, blocks };
}

const RICH_BLOCKS: SectionBlock[] = [
  {
    id: "h2a",
    type: "heading",
    data: { level: 2, text: "1. Linked heading", offer_id: "off_HEAD" },
  },
  {
    id: "grp",
    type: "choice_button_group",
    data: {
      layout_binding: "default.choiceButtonGroup",
      prompt: "Pick one",
      items: [
        { id: "i1", text: "First", offer_id: "off_A", style_id: "reference-choice-button" },
        { id: "i2", text: "Second", offer_id: "off_B", style_id: "reference-choice-button", analytics_label: "l2" },
        { id: "i3", text: "Third", offer_id: "off_A", style_id: "reference-choice-button" },
      ],
    },
  },
  {
    id: "para",
    type: "paragraph",
    data: { text: "x", html: 'Try <a data-offer="off_INL">this one</a> today' },
  },
  {
    id: "lst",
    type: "list",
    data: {
      marker: "check",
      items: ["plain item", 'with <a data-offer="off_LIT">a list link</a>'],
    },
  },
  {
    id: "img",
    type: "linked_image",
    data: { image_url: "/media/x.jpg", alt: "alt text", offer_id: "off_IMG", link_instance_id: "" },
  },
  {
    id: "cta",
    type: "final_text_cta",
    data: { link_instance_id: "", text: "Final call", offer_id: "off_CTA" },
  },
];

const OFFER_IDS = new Map<string, number>([
  ["off_HEAD", 11],
  ["off_A", 12],
  ["off_B", 13],
  ["off_INL", 14],
  ["off_LIT", 15],
  ["off_IMG", 16],
  ["off_CTA", 17],
]);

const PUBLIC_BY_ID = new Map<number, string>([...OFFER_IDS].map(([pub, id]) => [id, pub]));

describe("extractLinkInstances — Phase-4 grammar (§30.5)", () => {
  it("extracts every governed element in document order with the right roles", () => {
    const extracted = extractLinkInstances(source(RICH_BLOCKS, 99));
    expect(extracted.map((e) => [e.block_id, e.link_role])).toEqual([
      ["__headline__", "headline"],
      ["h2a", "inline"], // linked section heading
      ["grp", "choice_button"],
      ["grp", "choice_button"],
      ["grp", "choice_button"],
      ["para", "inline"],
      ["lst", "inline"], // offerlink inside a string list item
      ["img", "linked_image"],
      ["cta", "final_text_cta"],
    ]);
    expect(extracted.map((e) => e.position_index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("choice items carry style_id, group id (the block id) and analytics_label", () => {
    const extracted = extractLinkInstances(source(RICH_BLOCKS));
    const choices = extracted.filter((e) => e.link_role === "choice_button");
    expect(choices).toHaveLength(3);
    for (const c of choices) {
      expect(c.button_style_id).toBe("reference-choice-button");
      expect(c.button_group_id).toBe("grp");
    }
    expect(choices[1]?.analytics_label).toBe("l2");
    expect(choices.map((c) => c.offer_public_id)).toEqual(["off_A", "off_B", "off_A"]);
  });

  it("linked_image uses alt as anchor text; final_text_cta uses its text", () => {
    const extracted = extractLinkInstances(source(RICH_BLOCKS));
    const img = extracted.find((e) => e.link_role === "linked_image");
    expect(img?.anchor_text).toBe("alt text");
    const cta = extracted.find((e) => e.link_role === "final_text_cta");
    expect(cta?.anchor_text).toBe("Final call");
  });
});

describe("applyLinkInstances — enrichment parity (§30.9)", () => {
  async function enrich(headline: number | null) {
    const src = source(RICH_BLOCKS, headline);
    const extracted = extractLinkInstances(src);
    const resolved = await resolveLinkInstances(extracted, OFFER_IDS, []);
    const blocks = applyLinkInstances(src, resolved, PUBLIC_BY_ID);
    return { src, extracted, resolved, blocks };
  }

  it("stamps every governed element with its resolved lnk_… id (1:1 with extraction)", async () => {
    const { resolved, blocks } = await enrich(99);
    // resolved[0] is the headline (DB-only); content ids start at 1.
    const heading = blocks[0]?.data as Record<string, unknown>;
    expect(heading.link_instance_id).toBe(resolved[1]?.public_id);
    const items = (blocks[1]?.data.items ?? []) as Array<Record<string, unknown>>;
    expect(items.map((i) => i.link_instance_id)).toEqual([
      resolved[2]?.public_id,
      resolved[3]?.public_id,
      resolved[4]?.public_id,
    ]);
    const para = blocks[2]?.data as Record<string, unknown>;
    expect(para.html).toContain(`data-link-instance="${resolved[5]?.public_id}"`);
    const listItems = (blocks[3]?.data.items ?? []) as string[];
    expect(listItems[1]).toContain(`data-link-instance="${resolved[6]?.public_id}"`);
    const img = blocks[4]?.data as Record<string, unknown>;
    expect(img.link_instance_id).toBe(resolved[7]?.public_id);
    const cta = blocks[5]?.data as Record<string, unknown>;
    expect(cta.link_instance_id).toBe(resolved[8]?.public_id);
    // Every id is a lnk_… ULID.
    for (const r of resolved) {
      expect(r.public_id).toMatch(/^lnk_/);
    }
  });

  it("re-extracting the enriched document yields the SAME governed sequence (walk parity)", async () => {
    const { src, extracted, blocks } = await enrich(99);
    const reExtracted = extractLinkInstances({ ...src, blocks });
    expect(reExtracted.map((e) => [e.block_id, e.link_role, e.position_index])).toEqual(
      extracted.map((e) => [e.block_id, e.link_role, e.position_index]),
    );
  });

  it("does not mutate the input blocks", async () => {
    const src = source(JSON.parse(JSON.stringify(RICH_BLOCKS)) as SectionBlock[]);
    const before = JSON.stringify(src.blocks);
    const extracted = extractLinkInstances(src);
    const resolved = await resolveLinkInstances(extracted, OFFER_IDS, []);
    applyLinkInstances(src, resolved, PUBLIC_BY_ID);
    expect(JSON.stringify(src.blocks)).toBe(before);
  });

  it("enrichment is idempotent: a second resolve+apply over the enriched doc is byte-stable (lnk_ stability)", async () => {
    const { src, resolved, blocks } = await enrich(null);
    // Simulate the next save: the enriched doc comes back; existing DB rows
    // carry the resolved placements.
    const existing: ExistingLinkInstanceRow[] = resolved.map((r) => ({
      public_id: r.public_id,
      block_id: r.block_id,
      link_role: r.link_role,
      position_index: r.position_index,
      offer_id: r.offer_id,
    }));
    const extracted2 = extractLinkInstances({ ...src, blocks });
    const resolved2 = await resolveLinkInstances(extracted2, OFFER_IDS, existing);
    expect(resolved2.map((r) => r.public_id)).toEqual(resolved.map((r) => r.public_id));
    const blocks2 = applyLinkInstances({ ...src, blocks }, resolved2, PUBLIC_BY_ID);
    expect(JSON.stringify(blocks2)).toBe(JSON.stringify(blocks));
  });

  it("normalizes legacy numeric offer refs to off_… public ids (§30.5 stores strings)", async () => {
    const numericBlocks: SectionBlock[] = [
      { id: "b1", type: "button", data: { text: "Go", offer_id: 12 } },
    ];
    const src = source(numericBlocks);
    const extracted = extractLinkInstances(src);
    expect(extracted[0]?.offer_id).toBe(12);
    const resolved = await resolveLinkInstances(extracted, OFFER_IDS, []);
    const blocks = applyLinkInstances(src, resolved, PUBLIC_BY_ID);
    expect((blocks[0]?.data as Record<string, unknown>).offer_id).toBe("off_A");
  });
});

describe("aggregateSectionOffers over the Phase-4 roles", () => {
  it("one row per (offer, role) with occurrence counts", async () => {
    const extracted = extractLinkInstances(source(RICH_BLOCKS));
    const resolved = await resolveLinkInstances(extracted, OFFER_IDS, []);
    const rows = aggregateSectionOffers(resolved);
    const key = (r: { offer_id: number; link_role: string }): string =>
      `${r.offer_id}:${r.link_role}`;
    const byKey = new Map(rows.map((r) => [key(r), r.occurrences]));
    expect(byKey.get("12:choice_button")).toBe(2); // off_A twice in the group
    expect(byKey.get("13:choice_button")).toBe(1);
    expect(byKey.get("16:linked_image")).toBe(1);
    expect(byKey.get("17:final_text_cta")).toBe(1);
    expect(byKey.get("11:inline")).toBe(1); // linked heading
  });
});
