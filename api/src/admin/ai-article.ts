// POST /api/admin/ai/article — the writer's one-click full article.
//
// Fuses the provisioning pipeline's OWN composer path (generateStarterArticle
// → buildArticleContentJson) with the two feature-image generations (hero +
// the reserved mid-article slot), WITHOUT ever inserting into `articles`:
// the writer's open form is the only sink and Save stays a human act. Every
// provider call lands in ai_generations as a receipt, exactly like the
// pipeline's. One vocabulary, one composer — the panel emits the same block
// document the 15-articles machinery emits.
import type { Context } from "hono";
import type { Env } from "../env";
import { generateStarterArticle } from "../ai/generators/text";
import { generateFeatureImage } from "../ai/generators/image";
import type { GeneratedArticle } from "../ai/schemas";
import { buildArticleContentJson } from "../site-provisioning/steps";

export type ArticleCtx = Context<{ Bindings: Env }>;

interface FullArticleBody {
  site_id?: unknown;
  title?: unknown;
  brief?: unknown;
  tone?: unknown;
  length?: unknown;
  images?: { hero?: unknown; mid?: unknown } | null;
}

// The pipeline's field rounding (steps.ts generateOneTextUnit): seo_title is
// the title clipped to 70, seo_description prefers a real summary sentence
// clipped to 155, subtitle clips to the form's 160 maxlength.
export function deriveArticleFields(
  parsed: GeneratedArticle,
  fallbackTitle: string,
  authorName: string,
): {
  title: string;
  subtitle: string | null;
  seo_title: string;
  seo_description: string;
  author_name: string;
} {
  const title =
    typeof parsed.title === "string" && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : fallbackTitle;
  const subtitle =
    typeof parsed.subtitle === "string" && parsed.subtitle.trim().length > 0
      ? parsed.subtitle.trim().slice(0, 160)
      : null;
  const introFirst = (typeof parsed.intro === "string" ? parsed.intro : "")
    .split(/\n\n+/)[0]!
    .trim();
  const seoDescription = (introFirst.length > 0 ? introFirst : title).slice(0, 155);
  return {
    title,
    subtitle,
    seo_title: title.slice(0, 70),
    seo_description: seoDescription,
    author_name: authorName,
  };
}

// Mirror of the pipeline's fillMidArticleImage slot write (steps.ts:1492-1507):
// the composer reserves exactly one image block with src:"" after the first
// section; fill the FIRST such slot and leave everything else untouched.
export function fillFirstEmptyImageSlot(
  doc: { version: 2; blocks: Array<Record<string, unknown>> },
  src: string,
  alt: string,
): boolean {
  for (const block of doc.blocks) {
    if (
      block &&
      block["type"] === "image" &&
      (block["src"] === "" || block["src"] === undefined || block["src"] === null)
    ) {
      block["src"] = src;
      block["alt"] = alt;
      return true;
    }
  }
  return false;
}

function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length > 0 ? base : "article";
}

export async function generateFullArticle(c: ArticleCtx) {
  let body: FullArticleBody;
  try {
    body = await c.req.json<FullArticleBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const site_id = typeof body.site_id === "string" ? body.site_id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!site_id) return c.json({ error: "site_id is required" }, 400);
  if (!title) return c.json({ error: "title is required" }, 400);
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const tone = typeof body.tone === "string" ? body.tone.trim() : "";
  const length = typeof body.length === "string" ? body.length.trim() : "";
  const wantHero = body.images ? body.images.hero !== false : true;
  const wantMid = body.images ? body.images.mid !== false : true;

  const site = await c.env.DB.prepare(
    "SELECT id, name, vertical_slug FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(site_id)
    .first<{ id: string; name: string | null; vertical_slug: string | null }>();
  if (!site) return c.json({ error: "Unknown site_id" }, 404);
  const brand_name =
    typeof site.name === "string" && site.name.length > 0 ? site.name : site.id;
  const vertical =
    typeof site.vertical_slug === "string" ? site.vertical_slug : "";

  let authorName = `${brand_name} Editorial Team`;
  try {
    const row = await c.env.DB.prepare(
      "SELECT value AS value FROM site_settings WHERE site_id = ? AND key = ? LIMIT 1",
    )
      .bind(site_id, "default_author_name")
      .first<{ value: string | null }>();
    if (row && typeof row.value === "string" && row.value.trim().length > 0) {
      authorName = row.value.trim();
    }
  } catch {
    // Author default is best-effort; the brand fallback always stands.
  }

  // A fresh suffix per request: generateStarterArticle's idempotency is keyed
  // by (site_id, slug), and a writer pressing Generate again expects a NEW
  // article, not the cached one.
  const slug = `panel-${slugifyTitle(title)}-${crypto.randomUUID().slice(0, 8)}`;

  // Tone/length/brief fold into the summary the content preset interpolates
  // as {{summary}} — same variable the pipeline feeds from its article plan.
  const summaryParts: string[] = [];
  if (brief.length > 0) summaryParts.push(brief);
  if (tone.length > 0) summaryParts.push(`Tone: ${tone}.`);
  if (length.length > 0) summaryParts.push(`Target length: ${length}.`);
  const summary = summaryParts.join("\n");

  const generation_ids: string[] = [];
  const warnings: string[] = [];

  let article;
  try {
    article = await generateStarterArticle(c.env, {
      site_id,
      vertical,
      brand_name,
      title,
      summary,
      slug,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
  generation_ids.push(article.ai_generation_id);

  const fields = deriveArticleFields(article.parsed, title, authorName);
  if (!fields.subtitle) {
    warnings.push("The model returned no subtitle. Add one before publishing, or regenerate.");
  }
  const doc = buildArticleContentJson(article.parsed) as {
    version: 2;
    blocks: Array<Record<string, unknown>>;
  };

  let hero: { media_id: number; url: string } | null = null;
  if (wantHero) {
    try {
      const heroImage = await generateFeatureImage(c.env, {
        site_id,
        vertical,
        brand_name,
        article_title: fields.title,
        article_slug: slug,
        presetCategory: "feature-image",
      });
      generation_ids.push(heroImage.ai_generation_id);
      if (heroImage.media_id > 0) {
        hero = {
          media_id: heroImage.media_id,
          url: `/media/${heroImage.storage_key}`,
        };
      } else {
        warnings.push("Hero image generation returned no media.");
      }
    } catch (err) {
      warnings.push(
        `Hero image failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (wantMid) {
    try {
      const midImage = await generateFeatureImage(c.env, {
        site_id,
        vertical,
        brand_name,
        article_title: fields.title,
        article_slug: `${slug}-mid`,
        presetCategory: "feature-image",
      });
      generation_ids.push(midImage.ai_generation_id);
      if (midImage.media_id > 0) {
        const filled = fillFirstEmptyImageSlot(
          doc,
          `/media/${midImage.storage_key}`,
          `${fields.title} — illustration`,
        );
        if (!filled) warnings.push("No mid-article image slot to fill.");
      } else {
        warnings.push("Mid-article image generation returned no media.");
      }
    } catch (err) {
      warnings.push(
        `Mid-article image failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return c.json({
    ok: true,
    status: article.status,
    fields,
    content_json: doc,
    hero,
    warnings,
    generation_ids,
  });
}
