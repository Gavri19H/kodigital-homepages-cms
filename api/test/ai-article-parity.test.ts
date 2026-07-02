// Round-5 G3/G4 — the writer's one-click full article is the PIPELINE's
// article, byte-composed by the pipeline's own buildArticleContentJson.
//
// The structure gate compares against the LIVE structure of article 345
// (thecontentandcareer.com/article/content-career-salary-negotiation), pulled
// from prod D1 on 2026-07-02: 30 blocks — intro paragraph, key-idea quote,
// two more intro paragraphs, then 4× [heading + 3 paragraphs + list] with the
// reserved mid-article image slot after the FIRST section, then the
// "Editor's pick" affiliate, the "Key takeaways" callout, and 3 faq blocks.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildArticleContentJson } from "../src/site-provisioning/steps";
import type { GeneratedArticle } from "../src/ai/schemas";
import {
  deriveArticleFields,
  fillFirstEmptyImageSlot,
} from "../src/admin/ai-article";

// The exact block-type sequence of article 345 in prod D1 (2026-07-02).
const ARTICLE_345_SEQUENCE = [
  "paragraph", "quote", "paragraph", "paragraph",
  "heading", "paragraph", "paragraph", "paragraph", "list",
  "image",
  "heading", "paragraph", "paragraph", "paragraph", "list",
  "heading", "paragraph", "paragraph", "paragraph", "list",
  "heading", "paragraph", "paragraph", "paragraph", "list",
  "affiliate", "callout", "faq", "faq", "faq",
];

function section(n: number): GeneratedArticle["sections"][number] {
  return {
    heading: { level: 2, text: `Section ${n}` },
    paragraphs: [`S${n} para one.`, `S${n} para two.`, `S${n} para three.`],
    bullets: [`S${n} bullet one`, `S${n} bullet two`],
  } as never;
}

function fixtureArticle(): GeneratedArticle {
  return {
    title: "Salary Negotiation Tips for Content Professionals",
    subtitle: "The number you want needs a story behind it.",
    intro: "Intro one.\n\nIntro two.\n\nIntro three.",
    key_idea: "Preparation beats improvisation.",
    sections: [section(1), section(2), section(3), section(4)],
    takeaways: ["Do research", "Practice the ask", "Get it in writing"],
    editors_pick: { title: "A negotiation classic", why: "Because it works." },
    faqs: [
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
      { question: "Q3?", answer: "A3." },
    ],
  } as never;
}

describe("structure gate: the composer emits article 345's exact shape", () => {
  it("block-type sequence ≡ the live article", () => {
    const doc = buildArticleContentJson(fixtureArticle());
    expect(doc.version).toBe(2);
    expect(doc.blocks.map((b) => b.type)).toEqual(ARTICLE_345_SEQUENCE);
  });

  it("the mid-article slot is reserved empty after the first section", () => {
    const doc = buildArticleContentJson(fixtureArticle());
    const image = doc.blocks[9] as { type: string; src: string };
    expect(image.type).toBe("image");
    expect(image.src).toBe("");
  });

  it("callout is the Key-takeaways checklist; affiliate is the Editor's pick card", () => {
    const doc = buildArticleContentJson(fixtureArticle());
    const affiliate = doc.blocks[25] as Record<string, unknown>;
    const callout = doc.blocks[26] as Record<string, unknown>;
    expect(affiliate).toMatchObject({ type: "affiliate", url: null });
    expect(callout).toMatchObject({ type: "callout", title: "Key takeaways" });
    expect((callout as { items: string[] }).items).toHaveLength(3);
  });
});

describe("deriveArticleFields mirrors the pipeline's field rounding", () => {
  it("clips seo_title to 70, seo_description to 155 (from the intro), subtitle to 160", () => {
    const parsed = fixtureArticle();
    parsed.title = "T".repeat(90);
    parsed.subtitle = "s".repeat(200);
    parsed.intro = `${"d".repeat(200)}\n\nsecond para`;
    const f = deriveArticleFields(parsed, "fallback", "Author");
    expect(f.title).toBe("T".repeat(90));
    expect(f.seo_title).toHaveLength(70);
    expect(f.seo_description).toHaveLength(155);
    expect(f.subtitle).toHaveLength(160);
    expect(f.author_name).toBe("Author");
  });

  it("falls back to the writer's topic when the model returns no title", () => {
    const parsed = fixtureArticle();
    parsed.title = "";
    const f = deriveArticleFields(parsed, "Writer topic", "Author");
    expect(f.title).toBe("Writer topic");
    expect(f.seo_title).toBe("Writer topic");
  });
});

describe("fillFirstEmptyImageSlot mirrors fillMidArticleImage", () => {
  it("fills exactly the first empty slot and nothing else", () => {
    const doc = buildArticleContentJson(fixtureArticle()) as {
      version: 2;
      blocks: Array<Record<string, unknown>>;
    };
    const ok = fillFirstEmptyImageSlot(doc, "/media/ai/x/feature_image/s-mid.png", "alt");
    expect(ok).toBe(true);
    expect(doc.blocks[9]!["src"]).toBe("/media/ai/x/feature_image/s-mid.png");
    expect(doc.blocks.map((b) => b["type"])).toEqual(ARTICLE_345_SEQUENCE);
  });

  it("reports false when no slot exists", () => {
    const doc = { version: 2 as const, blocks: [{ type: "paragraph", text: "x" }] };
    expect(fillFirstEmptyImageSlot(doc as never, "/media/x.png", "alt")).toBe(false);
  });
});

// ---- Endpoint: mocked generators, fake D1 — asserts the fused flow ----

vi.mock("../src/ai/generators/text", () => ({
  generateStarterArticle: vi.fn(async () => ({
    ai_generation_id: "gen-text-1",
    idempotency_key: "k1",
    status: "success",
    parsed: fixtureArticle(),
  })),
}));

vi.mock("../src/ai/generators/image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ai/generators/image")>()),
  generateFeatureImage: vi.fn(async (_env: unknown, input: { article_slug: string }) => ({
    ai_generation_id: `gen-img-${input.article_slug}`,
    idempotency_key: `k-${input.article_slug}`,
    status: "success",
    media_id: input.article_slug.endsWith("-mid") ? 78 : 77,
    storage_key: `ai/site/feature_image/${input.article_slug}.png`,
    prompt: "p",
  })),
}));

import { generateFullArticle } from "../src/admin/ai-article";
import { generateStarterArticle } from "../src/ai/generators/text";
import { generateFeatureImage } from "../src/ai/generators/image";

function fakeDb() {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("FROM sites")) {
                return { id: "site-1", name: "The Brand", vertical_slug: "careers" };
              }
              if (sql.includes("FROM site_settings")) {
                return { value: "The Brand Editorial Team" };
              }
              return null;
            },
          };
        },
      };
    },
  };
}

function fakeContext(body: unknown, db: unknown = fakeDb()) {
  let jsonBody: unknown = null;
  let statusCode = 200;
  const c = {
    env: { DB: db },
    req: { json: async () => body },
    json(payload: unknown, status?: number) {
      jsonBody = payload;
      statusCode = status ?? 200;
      return { payload, status: statusCode };
    },
  };
  return {
    c: c as never,
    result: () => ({ body: jsonBody as Record<string, unknown>, status: statusCode }),
  };
}

describe("POST /api/admin/ai/article (fused pipeline flow, no INSERT)", () => {
  beforeEach(() => {
    vi.mocked(generateStarterArticle).mockClear();
    vi.mocked(generateFeatureImage).mockClear();
  });

  it("400s without a title; 400s without a site_id — before any spend", async () => {
    const a = fakeContext({ site_id: "site-1" });
    await generateFullArticle(a.c);
    expect(a.result().status).toBe(400);
    const b = fakeContext({ title: "T" });
    await generateFullArticle(b.c);
    expect(b.result().status).toBe(400);
    expect(vi.mocked(generateStarterArticle)).not.toHaveBeenCalled();
  });

  it("composes fields + 345-shaped blocks + hero + filled mid slot; 3 receipts", async () => {
    const t = fakeContext({
      site_id: "site-1",
      title: "Salary Negotiation Tips",
      brief: "Practical, first-person, concrete scripts.",
      tone: "professional",
      length: "long",
    });
    await generateFullArticle(t.c);
    const { body, status } = t.result();
    expect(status).toBe(200);
    expect(body["ok"]).toBe(true);
    const fields = body["fields"] as Record<string, string>;
    expect(fields["title"]).toBe("Salary Negotiation Tips for Content Professionals");
    expect(fields["subtitle"]).toBe("The number you want needs a story behind it.");
    expect(fields["author_name"]).toBe("The Brand Editorial Team");
    const doc = body["content_json"] as { blocks: Array<{ type: string; src?: string }> };
    expect(doc.blocks.map((b) => b.type)).toEqual(ARTICLE_345_SEQUENCE);
    expect(doc.blocks[9]!.src).toMatch(/^\/media\/ai\/site\/feature_image\/panel-.*-mid\.png$/);
    const hero = body["hero"] as { media_id: number; url: string };
    expect(hero.media_id).toBe(77);
    expect(hero.url).toMatch(/^\/media\/ai\/site\/feature_image\/panel-/);
    expect(body["generation_ids"]).toHaveLength(3);
    // The brief + tone + length fold into the summary the preset interpolates.
    const input = vi.mocked(generateStarterArticle).mock.calls[0]![1] as {
      summary: string;
      slug: string;
    };
    expect(input.summary).toContain("Practical, first-person");
    expect(input.summary).toContain("Tone: professional.");
    expect(input.summary).toContain("Target length: long.");
    expect(input.slug).toMatch(/^panel-salary-negotiation-tips-/);
  });

  it("image toggles off → zero image spend, slot stays empty (invisible on publish)", async () => {
    const t = fakeContext({
      site_id: "site-1",
      title: "T",
      images: { hero: false, mid: false },
    });
    await generateFullArticle(t.c);
    const { body } = t.result();
    expect(vi.mocked(generateFeatureImage)).not.toHaveBeenCalled();
    expect(body["hero"]).toBeNull();
    const doc = body["content_json"] as { blocks: Array<{ type: string; src?: string }> };
    expect(doc.blocks[9]!.src).toBe("");
    expect(body["generation_ids"]).toHaveLength(1);
  });

  it("an image failure degrades to a warning — the article still lands", async () => {
    vi.mocked(generateFeatureImage).mockRejectedValueOnce(new Error("provider down"));
    const t = fakeContext({ site_id: "site-1", title: "T" });
    await generateFullArticle(t.c);
    const { body, status } = t.result();
    expect(status).toBe(200);
    expect(body["hero"]).toBeNull();
    expect((body["warnings"] as string[]).join(" ")).toContain("Hero image failed");
    const doc = body["content_json"] as { blocks: Array<{ type: string }> };
    expect(doc.blocks.map((b) => b.type)).toEqual(ARTICLE_345_SEQUENCE);
  });

  it("unknown site → 404 before any spend", async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    };
    const t = fakeContext({ site_id: "nope", title: "T" }, db);
    await generateFullArticle(t.c);
    expect(t.result().status).toBe(404);
    expect(vi.mocked(generateStarterArticle)).not.toHaveBeenCalled();
  });
});

// ---- Round 6: the Article Builder — clicks in, the proven brief out ----

import {
  HOUSE_STRUCTURE,
  normalizeStructure,
  buildStructureRequirements,
  applyStructureSwitches,
  verifyStructure,
  normalizeImageAsk,
} from "../src/admin/ai-article";
import { pickFeatureImagePrompt } from "../src/ai/generators/image";

describe("R6: normalizeStructure — house defaults + clamping", () => {
  it("absent structure = the house standard (345's shape)", () => {
    expect(normalizeStructure(undefined)).toEqual(HOUSE_STRUCTURE);
  });
  it("clamps out-of-range clicks instead of failing", () => {
    const s = normalizeStructure({ sections: 99, paragraphs_per_section: 0, faqs: -3, takeaway_count: 100 });
    expect(s.sections).toBe(8);
    expect(s.paragraphs_per_section).toBe(1);
    expect(s.faqs).toBe(0);
    expect(s.takeaway_count).toBe(6);
  });
});

describe("R6: buildStructureRequirements — the proven formula from clicks", () => {
  it("default clicks produce the round-5-proven requirement lines", () => {
    const text = buildStructureRequirements(HOUSE_STRUCTURE, "content writers");
    expect(text).toContain("Audience: content writers.");
    expect(text).toContain("Exactly 4 sections, each with a specific search-friendly H2 subheadline and exactly 3 paragraphs.");
    expect(text).toContain("one bullet list of 3-5 items in every section");
    expect(text).toContain("key-idea pull quote");
    expect(text).toContain("Exactly 4 key takeaways.");
    expect(text).toContain("editor's pick recommendation");
    expect(text).toContain("Exactly 3 FAQs.");
    expect(text).toContain("subtitle teaser");
  });
  it("off-switches emit explicit negative instructions", () => {
    const text = buildStructureRequirements(
      { ...HOUSE_STRUCTURE, lists: false, quote: false, takeaway_count: 0, editors_pick: false, faqs: 0, subtitle: false },
      "",
    );
    expect(text).toContain("Do not include bullet lists");
    expect(text).toContain("No key idea");
    expect(text).toContain("No takeaways");
    expect(text).toContain("No editors_pick");
    expect(text).toContain("No FAQs");
    expect(text).not.toContain("subtitle teaser");
    expect(text).not.toContain("Audience:");
  });
});

describe("R6: applyStructureSwitches — off means OFF, deterministically", () => {
  it("stripped parts never reach the composed document", () => {
    const shaped = applyStructureSwitches(fixtureArticle(), {
      ...HOUSE_STRUCTURE,
      quote: false,
      takeaway_count: 0,
      editors_pick: false,
      faqs: 0,
      lists: false,
    });
    const types = buildArticleContentJson(shaped).blocks.map((b) => b.type);
    expect(types).not.toContain("quote");
    expect(types).not.toContain("callout");
    expect(types).not.toContain("affiliate");
    expect(types).not.toContain("faq");
    expect(types).not.toContain("list");
    // Sections + paragraphs + the image slot survive untouched.
    expect(types.filter((t) => t === "heading")).toHaveLength(4);
    expect(types).toContain("image");
  });
});

describe("R6: verifyStructure — count drift becomes a writer warning", () => {
  it("clean match = zero warnings", () => {
    expect(verifyStructure(fixtureArticle(), { ...HOUSE_STRUCTURE, takeaway_count: 3 })).toEqual([]);
  });
  it("section/faq/takeaway/subtitle drift each get a plain warning", () => {
    const parsed = fixtureArticle();
    parsed.subtitle = "";
    const w = verifyStructure(parsed, { ...HOUSE_STRUCTURE, sections: 5, faqs: 4, takeaway_count: 5 });
    expect(w.join(" ")).toContain("Asked for 5 sections, the model returned 4");
    expect(w.join(" ")).toContain("Asked for 4 FAQs, the model returned 3");
    expect(w.join(" ")).toContain("Asked for 5 key takeaways, the model returned 3");
    expect(w.join(" ")).toContain("no subtitle");
  });
});

describe("R6: image asks — both shapes + direction override", () => {
  it("normalizeImageAsk tolerates round-5 booleans and builder objects", () => {
    expect(normalizeImageAsk(true, true)).toEqual({ enabled: true, direction: "" });
    expect(normalizeImageAsk(false, true)).toEqual({ enabled: false, direction: "" });
    expect(normalizeImageAsk({ enabled: true, direction: " macro shot " }, true)).toEqual({ enabled: true, direction: "macro shot" });
    expect(normalizeImageAsk(undefined, true)).toEqual({ enabled: true, direction: "" });
  });
  it("a writer direction beats preset and built prompts; absent keeps legacy order", () => {
    expect(pickFeatureImagePrompt("macro shot", "preset", "built")).toBe("macro shot");
    expect(pickFeatureImagePrompt("  ", "preset", "built")).toBe("preset");
    expect(pickFeatureImagePrompt(undefined, null, "built")).toBe("built");
  });
});

describe("R6 endpoint: structure rides the summary; off-switches strip; drift warns", () => {
  beforeEach(() => {
    vi.mocked(generateStarterArticle).mockClear();
    vi.mocked(generateFeatureImage).mockClear();
  });

  it("clicked structure lands in the assembled summary verbatim", async () => {
    const t = fakeContext({
      site_id: "site-1",
      title: "T",
      audience: "career switchers",
      structure: { sections: 5, faqs: 4 },
      images: { hero: { enabled: false }, mid: { enabled: false } },
    });
    await generateFullArticle(t.c);
    const input = vi.mocked(generateStarterArticle).mock.calls[0]![1] as { summary: string };
    expect(input.summary).toContain("Audience: career switchers.");
    expect(input.summary).toContain("Exactly 5 sections");
    expect(input.summary).toContain("Exactly 4 FAQs.");
    // Fixture returns 4 sections + 3 faqs → honest drift warnings.
    const warnings = t.result().body["warnings"] as string[];
    expect(warnings.join(" ")).toContain("Asked for 5 sections, the model returned 4");
    expect(warnings.join(" ")).toContain("Asked for 4 FAQs, the model returned 3");
  });

  it("subtitle/seo toggled off → null fields even though the model returned them", async () => {
    const t = fakeContext({
      site_id: "site-1",
      title: "T",
      structure: { subtitle: false, seo: false },
      images: { hero: false, mid: false },
    });
    await generateFullArticle(t.c);
    const fields = t.result().body["fields"] as Record<string, unknown>;
    expect(fields["subtitle"]).toBeNull();
    expect(fields["seo_title"]).toBeNull();
    expect(fields["seo_description"]).toBeNull();
  });

  it("image directions flow into generateFeatureImage as promptOverride", async () => {
    const t = fakeContext({
      site_id: "site-1",
      title: "T",
      images: {
        hero: { enabled: true, direction: "warm desk scene, no people" },
        mid: { enabled: true, direction: "" },
      },
    });
    await generateFullArticle(t.c);
    const calls = vi.mocked(generateFeatureImage).mock.calls;
    expect(calls).toHaveLength(2);
    expect((calls[0]![1] as { promptOverride?: string }).promptOverride).toBe("warm desk scene, no people");
    expect((calls[1]![1] as { promptOverride?: string }).promptOverride).toBeUndefined();
  });
});
