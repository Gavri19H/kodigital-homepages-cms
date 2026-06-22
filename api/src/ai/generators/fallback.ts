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
  key_idea: string;
  sections: GeneratedArticleSection[];
  takeaways: string[];
  editors_pick: { title: string; why: string };
  faqs: GeneratedArticle["faqs"];
} {
  const v = vertical(input);
  const a = audience(input);
  const topic = title.trim().toLowerCase();
  // PR-2a: this is the no-API-key / model-failure body. It is still fully
  // generic (no invented stats, prices, brands, or quotes) and still satisfies
  // validateGeneratedArticle (>=3 h2, >=3 faqs, no placeholder/legacy refs),
  // but the prose is rewritten to read like a real editor wrote it: a concrete
  // opening, varied sentence length, plain hyphens, and ZERO em dashes. It now
  // also returns key_idea (the pull-quote) + takeaways (the "Key takeaways"
  // checklist) + a bullet list on one section, matching the extended schema.
  const key_idea =
    `Start from the outcome you actually want, pick the smallest thing that gets you there, then adjust.`;
  const intro =
    summary?.trim() ||
    `Most people meet ${topic} at the worst possible moment, when they need an answer fast and every source online says something different. ` +
      `This guide cuts through that. It is written in plain language for ${a}, and it does not assume you have done any of this before. ` +
      `By the end you will know what matters, what to ignore, and the first concrete step to take.`;
  const sections: GeneratedArticleSection[] = [
    {
      heading: { level: 2, text: `Where most people get stuck with ${topic}` },
      paragraphs: [
        `The hard part is rarely a lack of information. For ${a}, it is usually too much of it, ` +
          `pulling in different directions. The fix is to anchor on one question: what do you actually need this to do?`,
        `Answer that honestly and most of the noise falls away. The fancy options that looked essential turn out to be ` +
          `for a problem you do not have yet.`,
      ],
    },
    {
      heading: { level: 2, text: "A simple approach that holds up" },
      paragraphs: [
        `You do not need a perfect plan. You need a small one you will actually follow. Work it in order and adjust as real ` +
          `information arrives, not before.`,
      ],
      bullets: [
        "Write down the single outcome you want, in one sentence.",
        "List your real constraints: time you can give, money you can spend, what you already know.",
        "Pick the smallest option that fits those constraints and commit to it for a set period.",
        "Review once at the end of that period, then change one thing at a time.",
      ],
    },
    {
      heading: { level: 2, text: `What good looks like in ${v}` },
      paragraphs: [
        `A good result is not the most advanced one. It is the one you can keep up without resenting it. For ${a}, that ` +
          `usually means fewer moving parts, not more.`,
        `If a choice makes the next step easier to repeat, it is probably right for you. If it only looks impressive, ` +
          `it can wait.`,
      ],
    },
    {
      heading: { level: 2, text: "How to course-correct without starting over" },
      paragraphs: [
        `When something is not working, resist the urge to scrap the whole plan. Go back to the outcome and the constraints ` +
          `you wrote down, change one variable, and watch what happens. One new fact rarely justifies a full reset.`,
      ],
    },
  ];
  const takeaways = [
    `Name the one outcome you want before you compare any options.`,
    `Choose the smallest workable version and give it a fixed trial period.`,
    `Adjust one variable at a time instead of redoing the whole plan.`,
    `Simpler choices you can sustain beat impressive ones you cannot.`,
  ];
  // PR-2b: a deterministic "Editor's pick" recommendation. It is a habit/
  // approach (never an invented product, price, brand, or external link), so
  // the no-API-key card is still genuinely useful and policy-safe.
  const editors_pick = {
    title: `Keep a one-page decision note`,
    why:
      `Write your outcome, your constraints, and the option you picked on a single page, then revisit it at the ` +
      `end of your trial period. It keeps you honest about ${topic} and makes the next adjustment obvious.`,
  };
  const faqs = [
    {
      question: `What does getting started with ${topic} actually involve?`,
      answer:
        `Four short steps: name the outcome you want, write down your real constraints, pick the smallest option that fits, ` +
        `and review after a set period before changing anything.`,
    },
    {
      question: `How much time should ${a} budget for this?`,
      answer:
        `A first usable pass usually takes a few focused sessions rather than one marathon. Setting a fixed window keeps ` +
        `research from sprawling and gives you a real deadline to decide.`,
    },
    {
      question: `What is the most common mistake people make?`,
      answer:
        `Trying to compare every option before starting. A small working version teaches you more in a week than another ` +
        `month of reading, and it is far easier to improve.`,
    },
    {
      question: `Where should I look for more detail?`,
      answer:
        `Follow the primary sources behind each section rather than aggregator round-ups. Going one layer closer to the ` +
        `source is usually worth the extra few minutes.`,
    },
  ];
  return { intro, key_idea, sections, takeaways, editors_pick, faqs };
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
