// §7.2/§30.7/§31.9 governed URL builder + render-time anchor rewrite.

import { describe, it, expect } from "vitest";
import {
  buildGovernedUrl,
  rewriteGovernedAnchors,
  collectOfferRefs,
} from "../src/public/listicle/governed-url";

const ctx = {
  articlePublicId: "art_1",
  landerV: "ver_2",
  pageIndex: 3,
  sectionPublicId: "sec_4",
  candidatePublicId: "cand_5",
  selectionMode: "single",
  ruleId: "",
};

describe("buildGovernedUrl (§30.7 full-context /lc URL)", () => {
  it("carries EVERY §30.7 param incl. lnk/blk/role + the §31.9 pv placeholder", () => {
    const url = buildGovernedUrl(
      {
        offerPublicId: "off_9",
        linkInstanceId: "lnk_7",
        blockId: "blk_8",
        linkRole: "choice_button",
      },
      ctx,
    );
    expect(url.startsWith("/lc/off_9?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1] ?? "");
    expect(q.get("a")).toBe("art_1");
    expect(q.get("lv")).toBe("ver_2");
    expect(q.get("p")).toBe("3");
    expect(q.get("s")).toBe("sec_4");
    expect(q.get("c")).toBe("cand_5");
    expect(q.get("m")).toBe("single");
    expect(q.get("r")).toBe("");
    expect(q.get("lnk")).toBe("lnk_7");
    expect(q.get("blk")).toBe("blk_8");
    expect(q.get("role")).toBe("choice_button");
    // §31.9: the pv param EXISTS as an empty placeholder — page_view_id is
    // minted client-side per view (Phase 7 stamps it).
    expect(q.has("pv")).toBe(true);
    expect(q.get("pv")).toBe("");
  });

  it("rule_based candidate context carries its rule id as r", () => {
    const url = buildGovernedUrl(
      { offerPublicId: "off_9", linkInstanceId: "", blockId: "b", linkRole: "inline" },
      { ...ctx, selectionMode: "rule_based", ruleId: "rule_77" },
    );
    const q = new URLSearchParams(url.split("?")[1] ?? "");
    expect(q.get("m")).toBe("rule_based");
    expect(q.get("r")).toBe("rule_77");
  });
});

describe("rewriteGovernedAnchors (render-time href mint)", () => {
  const map = new Map<string, string>([
    ["off_9", "off_9"],
    ["42", "off_legacy42"],
  ]);

  it("mints the /lc href onto a governed anchor (attribute order preserved)", () => {
    const html =
      '<a data-offer="off_9" data-link-instance="lnk_1" data-block-id="blk_2" data-link-role="button" rel="sponsored nofollow noopener">Go</a>';
    const out = rewriteGovernedAnchors(html, ctx, map);
    expect(out).toContain('href="/lc/off_9?');
    expect(out).toContain("lnk=lnk_1");
    expect(out).toContain("blk=blk_2");
    expect(out).toContain("role=button");
    expect(out).toContain('data-offer="off_9"'); // original attrs intact
  });

  it("maps a legacy NUMERIC data-offer to its off_… public id", () => {
    const html = '<a data-offer="42" data-link-instance="" data-block-id="b" data-link-role="inline">x</a>';
    const out = rewriteGovernedAnchors(html, ctx, map);
    expect(out).toContain('href="/lc/off_legacy42?');
  });

  it("an unresolvable offer leaves the anchor INERT (no href, fail-safe)", () => {
    const html = '<a data-offer="off_ghost" data-link-role="inline">x</a>';
    const out = rewriteGovernedAnchors(html, ctx, map);
    expect(out).not.toContain("href=");
  });

  it("a hostile pre-existing href is DROPPED and replaced by the governed /lc URL", () => {
    const html =
      '<a href="https://evil.example/steal" data-offer="off_9" data-link-role="inline">x</a>';
    const out = rewriteGovernedAnchors(html, ctx, map);
    expect(out).not.toContain("evil.example");
    expect(out).toContain('href="/lc/off_9?');
    expect((out.match(/href=/g) ?? []).length).toBe(1);
  });

  it("non-governed anchors pass through untouched", () => {
    const html = '<a href="/about">about</a>';
    expect(rewriteGovernedAnchors(html, ctx, map)).toBe(html);
  });
});

describe("collectOfferRefs", () => {
  it("dedupes every data-offer reference in a fragment", () => {
    const html =
      '<a data-offer="off_9">a</a><a data-offer="42">b</a><a data-offer="off_9">c</a><a href="/x">d</a>';
    expect(collectOfferRefs(html).sort()).toEqual(["42", "off_9"]);
  });
});
