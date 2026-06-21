// T7: Deterministic fallback content for AI text generators.
//
// Every generator in api/src/ai/generators/text.ts has a paired fallback
// here so that a Worker without OPENAI_API_KEY -- or a Worker whose
// OpenAI call failed -- still produces a non-empty, vertical-generic
// payload that satisfies the GeneratedArticle / GeneratedStarterArticlePlan
// validators (>=3 h2, >=3 FAQs, exactly 15 plan items with unique slugs,
// no placeholder text, no banned legacy refs).

import type {
  GeneratedAboutPage,
  GeneratedAboutPageBlock,
  GeneratedAltText,
  GeneratedArticle,
  GeneratedArticleSection,
  GeneratedArticleSEO,
  GeneratedMeta,
  GeneratedSiteSettings,
  GeneratedStarterArticlePlan,
  GeneratedStarterArticlePlanItem,
} from "../schemas";

export interface FallbackContextBase {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
}

const DEFAULT_BRAND = "this site";
const DEFAULT_AUDIENCE = "general readers";

function brand(input: FallbackContextBase): string {
  return (input.brand_name || DEFAULT_BRAND).trim();
}

function audience(input: FallbackContextBase): string {
  return (input.audience || DEFAULT_AUDIENCE).trim();
}

function vertical(input: FallbackContextBase): string {
  return (input.vertical || "general topics").trim();
}

export function fallbackSiteTagline(input: FallbackContextBase): string {
  return `${brand(input)} — clear, helpful guidance on ${vertical(input)}.`;
}

export function fallbackSiteDescription(input: FallbackContextBase): string {
  return [
    `${brand(input)} publishes practical guides for ${audience(input)}`,
    `interested in ${vertical(input)}. Articles are written in plain language,`,
    `cover step-by-step decisions, and link to authoritative resources where`,
    `relevant. No marketing fluff.`,
  ].join(" ");
}

export function fallbackAboutPageBody(
  input: FallbackContextBase,
): GeneratedAboutPageBlock[] {
  const v = vertical(input);
  const a = audience(input);
  return [
    {
      type: "p",
      text:
        `${brand(input)} is an independent publication focused on ${v}. We write` +
        ` for ${a} who want straightforward, accurate information rather than` +
        ` salesy copy.`,
    },
    { type: "h2", text: "What we cover" },
    {
      type: "p",
      text:
        `Our editors pick topics that matter to readers who are new to ${v}` +
        ` and to those who already have some experience. Every article walks` +
        ` through the trade-offs in plain language.`,
    },
    { type: "h2", text: "How we work" },
    {
      type: "ul",
      items: [
        "We read primary sources before we summarise them.",
        "We disclose any limits in our knowledge.",
        "We update articles when the facts change.",
      ],
    },
    { type: "h2", text: "Contact" },
    {
      type: "p",
      text:
        `Spotted something wrong? Email the editors. We read every message and` +
        ` correct mistakes promptly.`,
    },
  ];
}

// rescue-4: `count` is the end-to-end provisioning knob (STARTER_ARTICLE_TARGET).
// The fallback MUST yield EXACTLY `count` items with unique kebab-case slugs so
// the no-API-key / model-failure path provisions the same number of starter
// articles the operator asked for. A curated set of stems covers the first 15
// topics; beyond that we deterministically template additional evergreen items
// (indexed) so any `count` (e.g. 35, 100) is satisfied with unique slugs.
export function fallbackArticlePlanItems(
  input: FallbackContextBase,
  count = 15,
): GeneratedStarterArticlePlanItem[] {
  const v = vertical(input);
  const a = audience(input);
  const stems: Array<[string, string, string]> = [
    [
      "getting-started",
      `Getting started with ${v}`,
      `An entry-level walkthrough for ${a} new to ${v}.`,
    ],
    [
      "common-mistakes",
      `Common mistakes to avoid in ${v}`,
      `Pitfalls that ${a} report most often and how to step around them.`,
    ],
    [
      "key-terms",
      `Key terms in ${v} explained`,
      `Plain-language definitions of the vocabulary you will meet first.`,
    ],
    [
      "step-by-step-decisions",
      `Step-by-step decisions in ${v}`,
      `A simple decision framework that fits most situations.`,
    ],
    [
      "questions-to-ask",
      `Questions to ask before starting in ${v}`,
      `A short checklist before you commit time or money to ${v}.`,
    ],
    [
      "myths-vs-facts",
      `Myths vs facts about ${v}`,
      `Claims you will see online and what the evidence actually says.`,
    ],
    [
      "budget-and-cost",
      `Budgeting realistically for ${v}`,
      `A grounded view of what ${v} typically costs and where to economise.`,
    ],
    [
      "time-investment",
      `How much time ${v} actually takes`,
      `Setting honest expectations for the hours involved.`,
    ],
    [
      "tools-and-resources",
      `Useful tools and resources for ${v}`,
      `Free and paid resources we have actually used and can recommend.`,
    ],
    [
      "case-study",
      `A realistic ${v} case study`,
      `A composite example walked through end to end with the numbers.`,
    ],
    [
      "comparing-options",
      `Comparing your options in ${v}`,
      `Side-by-side trade-offs so you can pick what fits your context.`,
    ],
    [
      "going-deeper",
      `Going deeper in ${v}`,
      `Where to look once the basics feel comfortable.`,
    ],
    [
      "checklist",
      `A printable ${v} checklist`,
      `Ten items to confirm before you act, written for ${a}.`,
    ],
    [
      "review-criteria",
      `How we review ${v} resources`,
      `The criteria our editors use when assessing third-party material.`,
    ],
    [
      "faq",
      `Frequently asked questions about ${v}`,
      `Direct answers to the questions ${a} ask most.`,
    ],
  ];
  const n = Math.max(0, Math.trunc(count));
  const items: GeneratedStarterArticlePlanItem[] = [];
  for (let i = 0; i < n; i++) {
    if (i < stems.length) {
      const [slug, title, summary] = stems[i]!;
      items.push({ slug, title, summary });
    } else {
      // Beyond the curated stems: deterministic, index-templated evergreen
      // items. The 1-based topic number keeps slugs unique and titles distinct
      // for any count without inventing stats/prices/locations.
      const topic = i + 1;
      items.push({
        slug: `${v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "topic"}-guide-${topic}`,
        title: `${capitalize(v)} guide ${topic}`,
        summary: `Part ${topic} of an evergreen series helping ${a} get more from ${v}.`,
      });
    }
  }
  return items;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export function fallbackArticleBody(
  input: FallbackContextBase,
  slug: string,
  title: string,
  summary?: string,
): {
  intro: string;
  sections: GeneratedArticleSection[];
  faqs: GeneratedArticle["faqs"];
} {
  const v = vertical(input);
  const a = audience(input);
  const intro =
    summary?.trim() ||
    `This article gives ${a} a practical, step-by-step view of ${title.toLowerCase()}` +
      ` in ${v}. It is written in plain language and does not assume prior knowledge.`;
  const sections: GeneratedArticleSection[] = [
    {
      heading: { level: 2, text: "What to know first" },
      paragraphs: [
        `${title} is a recurring topic for ${a} working with ${v}. The core idea is` +
          ` simpler than it looks: start from what you actually need, then pick the` +
          ` minimum tooling and habits that get you there.`,
        `If you are completely new, skip ahead to the checklist at the bottom — it` +
          ` is the shortest path to a workable first attempt.`,
      ],
    },
    {
      heading: { level: 2, text: "Step-by-step approach" },
      paragraphs: [
        `Step 1: clarify the outcome you want before researching tools. Step 2:` +
          ` write down the constraints — time, budget, prior experience. Step 3:` +
          ` pick the smallest workable option and commit to it for a defined period.`,
        `Most readers find that the bottleneck is decision fatigue rather than` +
          ` missing information. The steps above remove most of the noise.`,
      ],
    },
    {
      heading: { level: 2, text: "Common questions" },
      paragraphs: [
        `Readers regularly ask three things about ${slug}: how much it costs, how` +
          ` long it takes, and how to know they made the right choice. The FAQs at` +
          ` the end address each of those directly.`,
      ],
    },
    {
      heading: { level: 2, text: "Where to go next" },
      paragraphs: [
        `Once you have completed a first pass, revisit the constraints you wrote` +
          ` down. Adjust one variable at a time. Avoid the temptation to redo the` +
          ` entire plan because of a single new piece of information.`,
      ],
    },
  ];
  const faqs = [
    {
      question: `What does ${title.toLowerCase()} actually involve?`,
      answer:
        `It involves the four steps in the article: clarify the outcome, write down` +
        ` constraints, pick the smallest workable option, and review after a fixed` +
        ` period.`,
    },
    {
      question: `How much time should ${a} budget for this?`,
      answer:
        `A first usable pass typically takes a few short sessions. Setting a fixed` +
        ` window prevents open-ended research.`,
    },
    {
      question: `What is the most common mistake?`,
      answer:
        `Trying to compare every available option before starting. A smaller` +
        ` working version beats a perfect plan that never ships.`,
    },
    {
      question: `Where can I look for more detail?`,
      answer:
        `Use the linked references inside each section. They point at primary` +
        ` sources rather than aggregator articles.`,
    },
  ];
  return { intro, sections, faqs };
}

export function fallbackArticleSEO(
  title: string,
  intro: string | undefined,
): { meta_title: string; meta_description: string } {
  const truncate = (s: string, max: number): string =>
    s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
  const meta_title = truncate(title.trim() || "Article", 60);
  const fallbackDescription =
    intro?.trim() ||
    "A practical, plain-language overview of the topic for general readers.";
  const meta_description = truncate(fallbackDescription, 150);
  return { meta_title, meta_description };
}

export function fallbackAltText(context_kind: string, slug?: string): string {
  if (context_kind === "logo") {
    return "Site logo — abstract mark, no embedded text.";
  }
  if (context_kind === "feature_image") {
    return `Feature illustration for ${slug ?? "this article"} — neutral editorial style.`;
  }
  return "Inline illustration accompanying the article body.";
}

export function buildFallbackMeta(
  task: string,
  model: string,
  prompt_version: string,
  ai_generation_id: string,
  status: GeneratedMeta["status"] = "skipped_no_api_key",
): GeneratedMeta {
  return { task, model, prompt_version, status, ai_generation_id };
}

export function fallbackSiteSettings(
  input: FallbackContextBase,
  meta: GeneratedMeta,
): GeneratedSiteSettings {
  return {
    meta,
    site_id: input.site_id,
    tagline: fallbackSiteTagline(input),
    description: fallbackSiteDescription(input),
  };
}

export function fallbackAboutPage(
  input: FallbackContextBase,
  meta: GeneratedMeta,
): GeneratedAboutPage {
  return {
    meta,
    site_id: input.site_id,
    title: `About ${brand(input)}`,
    body: fallbackAboutPageBody(input),
  };
}

export function fallbackStarterArticlePlan(
  input: FallbackContextBase,
  meta: GeneratedMeta,
  count = 15,
): GeneratedStarterArticlePlan {
  return {
    meta,
    site_id: input.site_id,
    items: fallbackArticlePlanItems(input, count),
  };
}

export function fallbackArticleSEOPayload(
  site_id: string,
  article_slug: string,
  article_title: string,
  article_intro: string | undefined,
  meta: GeneratedMeta,
): GeneratedArticleSEO {
  const seo = fallbackArticleSEO(article_title, article_intro);
  return {
    meta,
    site_id,
    article_slug,
    meta_title: seo.meta_title,
    meta_description: seo.meta_description,
  };
}

export function fallbackAltTextPayload(
  site_id: string,
  media_id: string,
  context_kind: "logo" | "feature_image" | "inline",
  meta: GeneratedMeta,
  slug?: string,
): GeneratedAltText {
  return {
    meta,
    site_id,
    media_id,
    alt_text: fallbackAltText(context_kind, slug),
  };
}
