// POST /api/admin/ai/article — the writer's one-click full article.
//
// Fuses the provisioning pipeline's OWN composer path (generateStarterArticle
// → buildArticleContentJson) with the two feature-image generations (hero +
// the reserved mid-article slot), WITHOUT ever inserting into `articles`:
// the writer's open form is the only sink and Save stays a human act. Every
// provider call lands in ai_generations as a receipt, exactly like the
// pipeline's. One vocabulary, one composer — the panel emits the same block
// document the 15-articles machinery emits.
//
// Round 6 — the Article Builder contract: the STRUCTURE arrives as clicks
// (sections/paragraphs/FAQs/takeaways/toggles), not prose. The server
// assembles the requirements text from them (the exact formula proven to
// reproduce the house structure), deterministically STRIPS parts the writer
// switched off, and verifies the returned counts against the requested ones
// so the writer is never silently short-changed.
import type { Context } from "hono";
import type { Env } from "../env";
import { generateStarterArticle } from "../ai/generators/text";
import { generateFeatureImage } from "../ai/generators/image";
import type { GeneratedArticle } from "../ai/schemas";
import { buildArticleContentJson } from "../site-provisioning/steps";
import { resolveSiteAudience } from "../ai/site-audience";
import { TenantBoundaryViolation } from "../site/tenant-guards";
import {
  readAiVerticalContext,
  resolveArticleVerticalSlug,
} from "./verticals-handlers";

export type ArticleCtx = Context<{ Bindings: Env }>;

// The house standard = article 345's shape (the structure every starter
// article ships with): 4 sections × 3 paragraphs + a bullet list, pull-quote,
// 4 takeaways, editor's pick, 3 FAQs, subtitle, SEO pair.
export interface ArticleStructure {
  sections: number;
  paragraphs_per_section: number;
  lists: boolean;
  quote: boolean;
  takeaway_count: number; // 0 = no takeaways box
  editors_pick: boolean;
  faqs: number; // 0 = no FAQs
  subtitle: boolean;
  seo: boolean;
}

export const HOUSE_STRUCTURE: ArticleStructure = {
  sections: 4,
  paragraphs_per_section: 3,
  lists: true,
  quote: true,
  takeaway_count: 4,
  editors_pick: true,
  faqs: 3,
  subtitle: true,
  seo: true,
};

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export function normalizeStructure(raw: unknown): ArticleStructure {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    sections: clampInt(r.sections, 1, 8, HOUSE_STRUCTURE.sections),
    paragraphs_per_section: clampInt(
      r.paragraphs_per_section,
      1,
      6,
      HOUSE_STRUCTURE.paragraphs_per_section,
    ),
    lists: r.lists === undefined ? HOUSE_STRUCTURE.lists : r.lists === true,
    quote: r.quote === undefined ? HOUSE_STRUCTURE.quote : r.quote === true,
    takeaway_count: clampInt(r.takeaway_count, 0, 6, HOUSE_STRUCTURE.takeaway_count),
    editors_pick:
      r.editors_pick === undefined ? HOUSE_STRUCTURE.editors_pick : r.editors_pick === true,
    faqs: clampInt(r.faqs, 0, 6, HOUSE_STRUCTURE.faqs),
    subtitle: r.subtitle === undefined ? HOUSE_STRUCTURE.subtitle : r.subtitle === true,
    seo: r.seo === undefined ? HOUSE_STRUCTURE.seo : r.seo === true,
  };
}

// The exact requirements formula the round-5 prod pass proved reproduces the
// house structure — now assembled FROM CLICKS, never typed by the writer.
export function buildStructureRequirements(
  s: ArticleStructure,
  audience: string,
): string {
  const lines: string[] = [];
  if (audience.length > 0) lines.push(`Audience: ${audience}.`);
  lines.push("Structure requirements (these override any defaults):");
  lines.push(
    `- Exactly ${s.sections} sections, each with a specific search-friendly H2 subheadline and exactly ${s.paragraphs_per_section} paragraphs.`,
  );
  lines.push(
    s.lists
      ? "- Include one bullet list of 3-5 items in every section."
      : "- Do not include bullet lists: return empty bullets for every section.",
  );
  lines.push(
    s.quote
      ? "- Include the key-idea pull quote."
      : "- No key idea: return an empty string for key_idea.",
  );
  lines.push(
    s.takeaway_count > 0
      ? `- Exactly ${s.takeaway_count} key takeaways.`
      : "- No takeaways: return an empty array.",
  );
  lines.push(
    s.editors_pick
      ? "- Include one editor's pick recommendation."
      : "- No editors_pick: return it with an empty title.",
  );
  lines.push(
    s.faqs > 0
      ? `- Exactly ${s.faqs} FAQs.`
      : "- No FAQs: return an empty array.",
  );
  if (s.subtitle) lines.push("- Include the subtitle teaser.");
  return lines.join("\n");
}

// Deterministic off-switches: what the writer turned OFF is stripped from the
// parsed article BEFORE composing, so it can never appear regardless of what
// the model returned. (buildArticleContentJson already skips empty parts.)
export function applyStructureSwitches(
  parsed: GeneratedArticle,
  s: ArticleStructure,
): GeneratedArticle {
  const out: GeneratedArticle = { ...(parsed as object) } as GeneratedArticle;
  if (!s.quote) (out as { key_idea?: string }).key_idea = "";
  if (s.takeaway_count === 0) (out as { takeaways?: string[] }).takeaways = [];
  if (!s.editors_pick) {
    (out as { editors_pick?: unknown }).editors_pick = undefined;
  }
  if (s.faqs === 0) (out as { faqs?: unknown[] }).faqs = [];
  if (!s.lists) {
    const sections = Array.isArray((out as { sections?: unknown[] }).sections)
      ? (out as { sections: Array<Record<string, unknown>> }).sections
      : [];
    (out as { sections: unknown[] }).sections = sections.map((sec) => ({
      ...sec,
      bullets: [],
    }));
  }
  return out;
}

// Returned-vs-requested verification: count mismatches become plain writer
// warnings (never silent). Off-switches are enforced by the strip above, so
// only the count-shaped asks are verified here.
export function verifyStructure(
  parsed: GeneratedArticle,
  s: ArticleStructure,
): string[] {
  const warnings: string[] = [];
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  if (sections.length !== s.sections) {
    warnings.push(
      `Asked for ${s.sections} sections, the model returned ${sections.length} - regenerate or edit.`,
    );
  }
  const offCount = sections.filter(
    (sec) =>
      !Array.isArray(sec?.paragraphs) ||
      sec.paragraphs.length !== s.paragraphs_per_section,
  ).length;
  if (sections.length > 0 && offCount > 0) {
    warnings.push(
      `${offCount} of ${sections.length} sections came back with a paragraph count other than ${s.paragraphs_per_section}.`,
    );
  }
  const faqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];
  if (s.faqs > 0 && faqs.length !== s.faqs) {
    warnings.push(`Asked for ${s.faqs} FAQs, the model returned ${faqs.length}.`);
  }
  const takeaways = Array.isArray(parsed.takeaways) ? parsed.takeaways : [];
  if (s.takeaway_count > 0 && takeaways.length !== s.takeaway_count) {
    warnings.push(
      `Asked for ${s.takeaway_count} key takeaways, the model returned ${takeaways.length}.`,
    );
  }
  if (
    s.subtitle &&
    !(typeof parsed.subtitle === "string" && parsed.subtitle.trim().length > 0)
  ) {
    warnings.push("The model returned no subtitle. Add one before publishing, or regenerate.");
  }
  return warnings;
}

// X06: the one error every failed "Full article" run returns. Nothing in the
// editor is filled when this comes back.
export const FULL_ARTICLE_AI_FAILED = "The AI didn't answer. Nothing was changed. Try again.";

// X06: Google descriptions end on a whole word. Up to 160 characters stay as
// they are; longer text is cut at the last whole word that fits in 157
// characters and gets "…" (so the result is at most 158 characters).
export const SEO_DESCRIPTION_MAX = 160;
export function cutAtWholeWord(text: string, max = SEO_DESCRIPTION_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const room = max - 3;
  // One extra character: if it is a space, the word ending at `room` is whole.
  const head = t.slice(0, room + 1);
  const lastSpace = head.lastIndexOf(" ");
  let cut = lastSpace > 0 ? head.slice(0, lastSpace) : t.slice(0, room);
  cut = cut.replace(/[\s,;:\-–—]+$/, "");
  return `${cut}…`;
}

// The pipeline's field rounding: subtitle clips to the form's 160 maxlength.
// X06: seo_title is the WHOLE title (Google shortens long titles itself), and
// seo_description prefers the intro's first paragraph, ending on a whole word.
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
  const seoDescription = cutAtWholeWord(introFirst.length > 0 ? introFirst : title);
  return {
    title,
    subtitle,
    seo_title: title,
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

interface ImageAsk {
  enabled: boolean;
  direction: string;
}

// Tolerates both the round-5 boolean shape ({hero:true}) and the builder's
// object shape ({hero:{enabled:true,direction:"..."}}).
export function normalizeImageAsk(raw: unknown, dflt: boolean): ImageAsk {
  if (raw === undefined || raw === null) return { enabled: dflt, direction: "" };
  if (typeof raw === "boolean") return { enabled: raw, direction: "" };
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      enabled: r.enabled !== false,
      direction: typeof r.direction === "string" ? r.direction.trim() : "",
    };
  }
  return { enabled: dflt, direction: "" };
}

interface FullArticleBody {
  site_id?: unknown;
  title?: unknown;
  brief?: unknown;
  tone?: unknown;
  length?: unknown;
  audience?: unknown;
  structure?: unknown;
  images?: { hero?: unknown; mid?: unknown } | null;
  // X01 Part C: the open Article (its saved vertical) and the editor's live
  // "Vertical" choice (null = "Same as site"). Both optional.
  article_id?: unknown;
  vertical_id?: unknown;
  // X06: {site_id, lookup:"audience"} only reads the site's audience (no AI
  // call) so the panel's "Audience" field can start filled with it.
  lookup?: unknown;
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
  if (body.lookup === "audience") {
    return c.json({ audience: await resolveSiteAudience(c.env.DB, site_id) });
  }
  if (!title) return c.json({ error: "title is required" }, 400);
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const tone = typeof body.tone === "string" ? body.tone.trim() : "";
  const length = typeof body.length === "string" ? body.length.trim() : "";
  const typedAudience = typeof body.audience === "string" ? body.audience.trim() : "";
  const structure = normalizeStructure(body.structure);
  const heroAsk = normalizeImageAsk(body.images?.hero, true);
  const midAsk = normalizeImageAsk(body.images?.mid, true);

  const site = await c.env.DB.prepare(
    "SELECT id, name, vertical_slug FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(site_id)
    .first<{ id: string; name: string | null; vertical_slug: string | null }>();
  if (!site) return c.json({ error: "Unknown site_id" }, 404);
  // X06: an empty "Audience" field means the site's own audience.
  const audience =
    typedAudience.length > 0 ? typedAudience : await resolveSiteAudience(c.env.DB, site_id);
  const brand_name =
    typeof site.name === "string" && site.name.length > 0 ? site.name : site.id;
  // X01 Part C: {{vertical}} = the Article's own vertical when set, else the
  // Site's (the editor's unsaved choice counts as the Article's).
  const verticalCtx = readAiVerticalContext(body);
  const vertical = await resolveArticleVerticalSlug(c.env.DB, {
    siteVerticalSlug:
      typeof site.vertical_slug === "string" ? site.vertical_slug : "",
    articleId: verticalCtx.articleId,
    override: verticalCtx.override,
  });

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

  // Brief + assembled structure requirements + tone/length fold into the
  // summary the content preset interpolates as {{summary}} — same variable
  // the pipeline feeds from its article plan.
  const summaryParts: string[] = [];
  if (brief.length > 0) summaryParts.push(brief);
  summaryParts.push(buildStructureRequirements(structure, audience));
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
      audience,
    });
  } catch (err) {
    // A tenant-boundary refusal is not "the AI didn't answer": retrying can't help.
    if (err instanceof TenantBoundaryViolation) {
      return c.json({ error: "This Article can't be written for this site. Nothing was changed." }, 403);
    }
    return c.json({ error: FULL_ARTICLE_AI_FAILED }, 502);
  }
  // X06: anything but a real answer (no key, timeout, bad JSON, a refused
  // answer) is a failure. The generator's fallback body would use the
  // operator's instructions as the intro, so none of it is returned.
  if (article.status !== "success") {
    return c.json({ error: FULL_ARTICLE_AI_FAILED }, 502);
  }
  generation_ids.push(article.ai_generation_id);
  // X06: a real answer with no intro gets the instructions as its intro from
  // the generator's filler; drop it rather than publish the instructions.
  if (typeof article.parsed.intro === "string" && article.parsed.intro.trim() === summary.trim()) {
    article = { ...article, parsed: { ...article.parsed, intro: "" } };
  }

  // Off-switches are enforced deterministically; count-asks are verified and
  // any drift is surfaced as a plain writer warning.
  const shaped = applyStructureSwitches(article.parsed, structure);
  warnings.push(...verifyStructure(shaped, structure));

  const fields = deriveArticleFields(shaped, title, authorName);
  if (!structure.subtitle) fields.subtitle = null;
  const seoFields = structure.seo
    ? { seo_title: fields.seo_title, seo_description: fields.seo_description }
    : { seo_title: null, seo_description: null };
  const doc = buildArticleContentJson(shaped) as {
    version: 2;
    blocks: Array<Record<string, unknown>>;
  };

  let hero: { media_id: number; url: string } | null = null;
  if (heroAsk.enabled) {
    try {
      const heroImage = await generateFeatureImage(c.env, {
        site_id,
        vertical,
        brand_name,
        article_title: fields.title,
        article_slug: slug,
        presetCategory: "feature-image",
        promptOverride: heroAsk.direction || undefined,
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

  if (midAsk.enabled) {
    try {
      const midImage = await generateFeatureImage(c.env, {
        site_id,
        vertical,
        brand_name,
        article_title: fields.title,
        article_slug: `${slug}-mid`,
        presetCategory: "feature-image",
        promptOverride: midAsk.direction || undefined,
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
    fields: {
      title: fields.title,
      subtitle: fields.subtitle,
      seo_title: seoFields.seo_title,
      seo_description: seoFields.seo_description,
      author_name: fields.author_name,
    },
    content_json: doc,
    hero,
    warnings,
    generation_ids,
  });
}
