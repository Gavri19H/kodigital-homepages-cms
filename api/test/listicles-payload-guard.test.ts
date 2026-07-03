// §22.4 hybrid rendering + payload guard — budget math + above/below-fold
// split behavior of the document renderer.

import { describe, it, expect } from "vitest";
import {
  withinCandidateBudget,
  renderListicleDocument,
  defaultCandidate,
  LST_CANDIDATE_BUDGET_BYTES,
  LST_CANDIDATE_BUDGET_RATIO,
  LST_ABOVE_FOLD_PAGE_COUNT,
  LST_LAZY_CANDIDATE_MIN_HEIGHT_PX,
  type ListicleRenderInput,
  type RenderPage,
  type RenderSectionRow,
} from "../src/public/listicle/render";

describe("withinCandidateBudget (the ~40KB / ~50% whichever-first predicate)", () => {
  it("config constants match §22.4", () => {
    expect(LST_CANDIDATE_BUDGET_BYTES).toBe(40 * 1024);
    expect(LST_CANDIDATE_BUDGET_RATIO).toBe(0.5);
    expect(LST_ABOVE_FOLD_PAGE_COUNT).toBeGreaterThanOrEqual(1);
    expect(LST_LAZY_CANDIDATE_MIN_HEIGHT_PX).toBeGreaterThan(0);
  });

  it("under both caps → within budget", () => {
    expect(withinCandidateBudget(10_000, 50_000)).toBe(true);
  });

  it("the 40KB absolute cap trips FIRST even with a huge inline payload", () => {
    expect(withinCandidateBudget(LST_CANDIDATE_BUDGET_BYTES + 1, 10_000_000)).toBe(false);
    expect(withinCandidateBudget(LST_CANDIDATE_BUDGET_BYTES, 10_000_000)).toBe(true);
  });

  it("the 50% ratio cap trips FIRST below 40KB", () => {
    // 30KB hidden vs 20KB inline → hidden is 60% of the total payload.
    expect(withinCandidateBudget(30_000, 20_000)).toBe(false);
    // exactly 50% is allowed ("under a strict budget" caps at the ratio).
    expect(withinCandidateBudget(20_000, 20_000)).toBe(true);
  });

  it("zero hidden bytes is always within budget", () => {
    expect(withinCandidateBudget(0, 0)).toBe(true);
    expect(withinCandidateBudget(0, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Renderer split behavior
// ---------------------------------------------------------------------------

function section(id: number, filler: string): RenderSectionRow {
  return {
    id,
    public_id: `sec_${id}`,
    section_name: `S${id}`,
    headline_text: `Neutral heading ${id}`,
    headline_offer_id: null,
    image_json: null,
    content_json: JSON.stringify({
      blocks: [{ type: "paragraph", data: { text: filler } }],
    }),
  };
}

function page(index: number, mode: string, candSections: number[]): RenderPage {
  return {
    public_id: `pg_${index}`,
    page_index: index,
    selection_mode: mode,
    ab_test_id: mode === "ab_test" ? `ab_${index}` : null,
    rule_set_id: null,
    candidates: candSections.map((sectionId, i) => ({
      public_id: `cand_${index}_${i}`,
      section_id: sectionId,
      is_fallback: mode === "rule_based" && i === candSections.length - 1 ? 1 : 0,
      rule_public_id: mode === "rule_based" && i < candSections.length - 1 ? `rule_${index}_${i}` : null,
    })),
  };
}

function makeInput(pages: RenderPage[], sections: Map<number, RenderSectionRow>): ListicleRenderInput {
  return {
    hostname: "tenant.example.com",
    brand: { siteName: "Tenant", logoUrl: null },
    settings: {},
    article: { public_id: "art_1", slug: "fixture" },
    version: {
      public_id: "ver_1",
      headline: "Line A\nLine B",
      intro_paragraph: "Intro paragraph.",
      hero_url: null,
      byline_json: null,
      layout_style_id: "default",
      content_version: 1,
    },
    pages,
    sections,
    offerPublicIdByRef: new Map(),
  };
}

describe("defaultCandidate (interim single_default semantics for all modes)", () => {
  it("single/ab_test → first candidate; rule_based → the FALLBACK", () => {
    expect(defaultCandidate(page(0, "single", [1, 2]))?.public_id).toBe("cand_0_0");
    expect(defaultCandidate(page(0, "ab_test", [1, 2]))?.public_id).toBe("cand_0_0");
    const rb = page(0, "rule_based", [1, 2, 3]);
    expect(defaultCandidate(rb)?.public_id).toBe("cand_0_2"); // is_fallback
  });
});

describe("under-budget shells inline ALL candidates (§22.4)", () => {
  it("hidden alternates ride as inert <template> blocks; default is a visible .lst-cand", () => {
    const sections = new Map<number, RenderSectionRow>([
      [1, section(1, "small a")],
      [2, section(2, "small b")],
    ]);
    const { html, lazyCandidateIds } = renderListicleDocument(
      makeInput([page(0, "ab_test", [1, 2])], sections),
    );
    expect(lazyCandidateIds).toEqual([]);
    expect(html).toContain('<div class="lst-cand" data-cand="cand_0_0"');
    expect(html).toContain('<template class="lst-cand-tpl" data-cand="cand_0_1"');
    // interim pre-paint visibility style marks the default candidate.
    expect(html).toContain('data-lst-chosen="interim-single-default"');
    expect(html).toContain('.lst-cand[data-cand="cand_0_0"]{display:block}');
    // no lazy machinery on an under-budget shell.
    expect(html).not.toContain("data-lst-lazy");
    expect(html).not.toContain("XMLHttpRequest");
  });
});

describe("over-budget shells lazy-hydrate ONLY below-fold pages (§22.4)", () => {
  // Build hidden-candidate HTML far over 40KB: 3 alternates × ~30KB filler.
  const bigFiller = "y".repeat(30 * 1024);
  const sections = new Map<number, RenderSectionRow>([
    [1, section(1, "visible small 1")],
    [2, section(2, bigFiller)],
    [3, section(3, "visible small 3")],
    [4, section(4, bigFiller)],
    [5, section(5, "visible small 5")],
    [6, section(6, bigFiller)],
  ]);
  const pages = [
    page(0, "ab_test", [1, 2]), // above-fold: stays inline even over budget
    page(1, "ab_test", [3, 4]), // below-fold: lazy-hydrates
    page(2, "ab_test", [5, 6]), // below-fold: lazy-hydrates
  ];
  const { html, lazyCandidateIds } = renderListicleDocument(makeInput(pages, sections));

  it("above-fold candidates are NEVER post-paint lazy-hydrated", () => {
    expect(html).toContain('<div class="lst-cand" data-cand="cand_0_0"'); // inline default
    expect(html).toContain('<template class="lst-cand-tpl" data-cand="cand_0_1"'); // inline alternate
    expect(lazyCandidateIds).not.toContain("cand_0_0");
  });

  it("below-fold pages emit reserved-dimension placeholders wired to /lst-cand/:id", () => {
    expect(lazyCandidateIds).toEqual(["cand_1_0", "cand_2_0"]);
    expect(html).toContain('data-lst-lazy="/lst-cand/cand_1_0"');
    expect(html).toContain('data-lst-lazy="/lst-cand/cand_2_0"');
    expect(html).toContain(`min-height:${LST_LAZY_CANDIDATE_MIN_HEIGHT_PX}px`);
    // their hidden alternates are NOT shipped in the shell at all.
    expect(html).not.toContain('data-cand="cand_1_1"');
    expect(html).not.toContain('data-cand="cand_2_1"');
    // the ES5 hydrator ships exactly because lazy candidates exist.
    expect(html).toContain("XMLHttpRequest");
  });
});
