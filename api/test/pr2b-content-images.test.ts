import { describe, it, expect, vi } from "vitest";

// PR-2b — editors_pick transform block (item 3) + mid-article image reserve &
// fill (item 4). The OpenAI client is mocked to return deterministic non-empty
// image bytes so the REAL generateFeatureImage + fillMidArticleImage path runs.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
vi.mock("../src/ai/openai-client", async () => {
  const actual = await vi.importActual<
    typeof import("../src/ai/openai-client")
  >("../src/ai/openai-client");
  return {
    ...actual,
    createOpenAIClient: () => ({
      hasApiKey: () => true,
      async generateText() {
        return { skipped_no_api_key: true } as const;
      },
      async generateImage() {
        return {
          bytes: PNG,
          mime: "image/png",
          model: "gpt-image-2",
          retries: 0,
          status: 200,
        };
      },
    }),
  };
});

import {
  buildArticleContentJson,
  generateOneImageUnit,
  type StepContext,
} from "../src/site-provisioning/steps";
import type { GeneratedArticle } from "../src/ai/schemas";
import type { AiGenerationRow } from "../src/ai/generation-log";
import type { Env } from "../src/env";

function baseArticle(overrides: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    meta: {
      task: "starter-article",
      model: "gpt-5.5",
      prompt_version: "starter-article:v1",
      status: "success",
    },
    site_id: "site-1",
    slug: "the-slug",
    title: "The Title",
    intro: "Para one.\n\nPara two.",
    key_idea: "One sharp idea.",
    sections: [
      { heading: { level: 2, text: "Section A" }, paragraphs: ["A body."] },
      { heading: { level: 2, text: "Section B" }, paragraphs: ["B body."] },
      { heading: { level: 2, text: "Section C" }, paragraphs: ["C body."] },
    ],
    takeaways: ["Take one.", "Take two.", "Take three."],
    faqs: [
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
      { question: "Q3?", answer: "A3." },
    ],
    ...overrides,
  };
}

describe("PR-2b item 3 — editors_pick transform", () => {
  it("emits an affiliate block (url:null, cta='Why we recommend it') AFTER the last section but BEFORE the takeaways callout", () => {
    const doc = buildArticleContentJson(
      baseArticle({
        editors_pick: { title: "Keep a decision note", why: "It keeps you honest." },
      }),
    );
    const types = doc.blocks.map((b) => b.type);
    const affiliateIdx = doc.blocks.findIndex((b) => b.type === "affiliate");
    const calloutIdx = doc.blocks.findIndex((b) => b.type === "callout");
    const lastHeadingIdx = types.lastIndexOf("heading");
    expect(affiliateIdx).toBeGreaterThan(lastHeadingIdx); // after the last section
    expect(affiliateIdx).toBeLessThan(calloutIdx); // before the "Key takeaways" callout
    const aff = doc.blocks[affiliateIdx];
    if (aff?.type !== "affiliate") throw new Error("expected an affiliate block");
    expect(aff.title).toBe("Keep a decision note");
    expect(aff.description).toBe("It keeps you honest.");
    expect(aff.url).toBeNull();
    expect(aff.cta).toBe("Why we recommend it");
  });

  it("emits NO affiliate block when editors_pick is absent or has an empty title", () => {
    expect(
      buildArticleContentJson(baseArticle()).blocks.some((b) => b.type === "affiliate"),
    ).toBe(false);
    expect(
      buildArticleContentJson(
        baseArticle({ editors_pick: { title: "   ", why: "x" } }),
      ).blocks.some((b) => b.type === "affiliate"),
    ).toBe(false);
  });
});

describe("PR-2b item 4 — mid-article image reserve", () => {
  it("reserves an empty-src image slot AFTER the first section (only when >=1 section)", () => {
    const doc = buildArticleContentJson(baseArticle());
    const imageBlocks = doc.blocks.filter((b) => b.type === "image");
    expect(imageBlocks).toHaveLength(1);
    const img = imageBlocks[0];
    if (img?.type !== "image") throw new Error("expected an image block");
    expect(img.src).toBe(""); // reserved, to be filled by the image step
    expect(img.alt).toContain("The Title");
    // It sits after the FIRST section's heading and before the SECOND.
    const imgIdx = doc.blocks.findIndex((b) => b.type === "image");
    const headingIdxs = doc.blocks
      .map((b, i) => (b.type === "heading" ? i : -1))
      .filter((i) => i >= 0);
    expect(imgIdx).toBeGreaterThan(headingIdxs[0]!);
    expect(imgIdx).toBeLessThan(headingIdxs[1]!);
  });

  it("reserves NO image slot for an article with zero sections", () => {
    const doc = buildArticleContentJson(baseArticle({ sections: [] }));
    expect(doc.blocks.some((b) => b.type === "image")).toBe(false);
  });
});

// ---- fake D1 modelling the SQL generateOneImageUnit + the image generator hit.
interface ArticleStoreRow {
  id: number;
  site_id: string;
  slug: string;
  title: string;
  content_json: string;
  featured_image_id: number | null;
}
interface MediaStoreRow {
  id: number;
  storage_key: string;
}
interface UnitStoreRow {
  site_id: string;
  unit_index: number;
  image_status: string;
  attempt_count: number;
}

function makeMidImageEnv(
  article: ArticleStoreRow,
  unit: UnitStoreRow,
  opts: { throwOnContentJsonWrite?: boolean } = {},
) {
  const ai = new Map<string, AiGenerationRow>();
  const media: MediaStoreRow[] = [];
  const r2 = new Map<string, ArrayBuffer>();
  let nextMediaId = 1;
  let imageGenerateCalls = 0;

  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
          return {
            id: article.site_id,
            name: "Brand Co",
            domain: "brand.example",
            vertical_slug: "home services",
          } as unknown as T;
        }
        if (sql.startsWith("SELECT") && sql.indexOf("FROM ai_generations") >= 0) {
          return (ai.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        if (sql.indexOf("SELECT id, slug, title FROM articles WHERE site_id = ? AND slug = ?") >= 0) {
          return { id: article.id, slug: article.slug, title: article.title } as unknown as T;
        }
        if (sql.indexOf("SELECT content_json FROM articles WHERE id = ?") >= 0) {
          return { content_json: article.content_json } as unknown as T;
        }
        if (sql.startsWith("INSERT INTO media")) {
          const id = nextMediaId++;
          media.push({ id, storage_key: String(captured[1] ?? "") });
          return { id } as unknown as T;
        }
        return null;
      },
      async run(): Promise<{ success: true }> {
        if (sql.startsWith("INSERT INTO ai_generations")) {
          const [id, site_id, task, provider, model, prompt_version, idempotency_key, request_json, target_type, target_id] =
            captured as [string, string | null, string, string, string, string, string, string | null, string | null, string | null];
          if (!ai.has(idempotency_key)) {
            ai.set(idempotency_key, {
              id, site_id, task, provider, model, prompt_version, idempotency_key,
              request_json, response_json: null, parsed_json: null,
              status: "pending", target_type, target_id, error_message: null,
              created_at: 1, updated_at: 1,
            });
            if (task === "feature-image") imageGenerateCalls += 1;
          }
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'success'")) {
          const key = captured[captured.length - 1] as string;
          const row = ai.get(key);
          if (row) row.status = "success";
        } else if (sql.indexOf("UPDATE articles SET featured_image_id") >= 0) {
          const [media_id, id] = captured as [number, number];
          if (article.id === id && (article.featured_image_id === null || article.featured_image_id === 0)) {
            article.featured_image_id = media_id;
          }
        } else if (sql.indexOf("UPDATE articles SET content_json = ?") >= 0) {
          if (opts.throwOnContentJsonWrite) {
            throw new Error("simulated content_json write failure");
          }
          const [content_json, id] = captured as [string, number];
          if (article.id === id) article.content_json = content_json;
        } else if (sql.indexOf("UPDATE provisioning_article_units SET image_status = 'done'") >= 0) {
          unit.image_status = "done";
        } else if (sql.indexOf("UPDATE provisioning_article_units SET attempt_count = ?") >= 0) {
          unit.attempt_count = captured[0] as number;
          if (sql.indexOf("image_status = 'failed'") >= 0) unit.image_status = "failed";
        }
        return { success: true };
      },
    };
    return stmt;
  };

  const env = {
    DB: { prepare } as unknown as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {
      async put(key: string, value: ArrayBuffer) {
        r2.set(key, value);
        return { key };
      },
    } as unknown as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.example",
    ADMIN_BASE_URL: "https://cms.example",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    OPENAI_API_KEY: "sk-livefakekey-pr2b",
  } as Env;

  const ctx: StepContext = {
    env,
    db: env.DB,
    site_id: article.site_id,
    job_id: "job-1",
    step_order: 11,
  };
  return { ctx, media, getImageGenerateCalls: () => imageGenerateCalls };
}

describe("PR-2b item 4 — mid-article image fill (real generateOneImageUnit path)", () => {
  function seed() {
    const doc = buildArticleContentJson(baseArticle());
    const article: ArticleStoreRow = {
      id: 7,
      site_id: "site-1",
      slug: "the-slug",
      title: "The Title",
      content_json: JSON.stringify(doc),
      featured_image_id: null,
    };
    const unit: UnitStoreRow = {
      site_id: "site-1",
      unit_index: 0,
      image_status: "pending",
      attempt_count: 0,
    };
    return { article, unit };
  }

  it("assigns the hero AND fills the FIRST empty image slot with /media/<key>, marking the unit done", async () => {
    const { article, unit } = seed();
    const { ctx, media, getImageGenerateCalls } = makeMidImageEnv(article, unit);
    const outcome = await generateOneImageUnit(ctx, {
      unit_index: 0,
      slug: "the-slug",
      title: "The Title",
      summary: null,
      text_status: "done",
      image_status: "pending",
      article_id: "the-slug",
      attempt_count: 0,
    });
    expect(outcome).toBe("done");
    expect(unit.image_status).toBe("done");
    // Hero assigned.
    expect(article.featured_image_id).not.toBeNull();
    // Mid-image filled the reserved slot.
    const filled = JSON.parse(article.content_json) as {
      blocks: Array<{ type: string; src?: string; alt?: string }>;
    };
    const img = filled.blocks.find((b) => b.type === "image");
    expect(img).toBeDefined();
    expect(img?.src ?? "").toMatch(/^\/media\/.+/);
    expect(img?.alt ?? "").toContain("The Title");
    // Two DISTINCT images were generated (hero + mid) with two media rows.
    expect(getImageGenerateCalls()).toBe(2);
    expect(media.length).toBe(2);
    // The two storage keys differ (hero vs mid are distinct images).
    expect(media[0]!.storage_key).not.toBe(media[1]!.storage_key);
  });

  it("a mid-image failure NEVER fails the unit — the hero stays done", async () => {
    const { article, unit } = seed();
    const { ctx } = makeMidImageEnv(article, unit, {
      throwOnContentJsonWrite: true,
    });
    const outcome = await generateOneImageUnit(ctx, {
      unit_index: 0, slug: "the-slug", title: "The Title", summary: null,
      text_status: "done", image_status: "pending", article_id: "the-slug", attempt_count: 0,
    });
    // The content_json write-back blew up, but the unit still completes and the
    // hero is still assigned — the mid-image is best-effort, never a unit-failer.
    expect(outcome).toBe("done");
    expect(unit.image_status).toBe("done");
    expect(unit.attempt_count).toBe(0); // no failure recorded against the unit
    expect(article.featured_image_id).not.toBeNull();
  });

  it("is idempotent — a re-run fills nothing new and does NOT generate a second mid-image", async () => {
    const { article, unit } = seed();
    // ONE env (shared ai_generations + media stores) so the re-run sees the
    // first run's receipts — exactly how a real resume/Queue redelivery behaves.
    const { ctx, getImageGenerateCalls } = makeMidImageEnv(article, unit);
    const unitRow = {
      unit_index: 0, slug: "the-slug", title: "The Title", summary: null,
      text_status: "done", image_status: "pending", article_id: "the-slug", attempt_count: 0,
    } as const;

    await generateOneImageUnit(ctx, { ...unitRow });
    const filledOnce = article.content_json;
    expect(getImageGenerateCalls()).toBe(2); // hero + mid on the first pass

    // Re-run on the SAME state. The hero short-circuits on its existing receipt;
    // the mid-image finds NO empty slot (already filled) → skips, never
    // generating a second mid-image. No new image generation happens at all.
    const outcome = await generateOneImageUnit(ctx, { ...unitRow });
    expect(outcome).toBe("done");
    expect(article.content_json).toBe(filledOnce); // unchanged
    expect(getImageGenerateCalls()).toBe(2); // still 2 — no new generation on re-run
  });
});
