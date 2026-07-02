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

vi.mock("../src/ai/generators/image", () => ({
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
