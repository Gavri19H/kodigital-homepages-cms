// [G1] seed:local deterministic fixture data.
//
// Single source of truth for BOTH the SQL builder (seed-sql.ts) and the
// bucket-coverage vitest (test/seed-local-sql.test.ts). Every value is a
// fixed literal — no clocks, no randomness, no network (brief BCL-024:
// deterministic proof only) — so repeated seeds converge on the same
// local database state.
//
// The article distribution intentionally fills EVERY Home view-model
// bucket (src/public/view-models/home.ts T12 contract):
//   - 4 is_featured rows  -> hero (1) + featured (3) + picks (4)
//   - 5 is_trending rows  -> trending strip (TRENDING_LIMIT = 5 exactly)
//   - 6 plain rows        -> latest
//   - 4 categories        -> chip rail
//   - newsletter_settings_json -> newsletter block
// Seed IDs live in the 9xxx namespace so they never collide with
// AUTOINCREMENT rows created through the admin UI or migration 0004.

export const SEED_SITE_ID = "st_seedlocal01";
export const SEED_HOSTNAME = "localhost";
export const SEED_EPOCH = 1780272000; // 2026-06-01T00:00:00Z, fixed anchor

export interface SeedVertical {
  id: number;
  slug: string;
  name: string;
}

export interface SeedCategory {
  id: number;
  slug: string;
  name: string;
  displayOrder: number;
}

export interface SeedMedia {
  id: number;
  filename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  altText: string;
}

export interface SeedSetting {
  id: number;
  key: string;
  value: string;
}

export interface SeedArticle {
  id: number;
  slug: string;
  title: string;
  categoryId: number;
  mediaId: number;
  isFeatured: 0 | 1;
  isTrending: 0 | 1;
  homepageRank: number | null;
  publishedAt: number;
  contentHtml: string;
  contentJson: string;
}

export const seedVertical: SeedVertical = {
  id: 9001,
  slug: "seed-local",
  name: "Seed Local",
};

export const seedCategories: ReadonlyArray<SeedCategory> = [
  { id: 9001, slug: "wellness", name: "Wellness", displayOrder: 1 },
  { id: 9002, slug: "nutrition", name: "Nutrition", displayOrder: 2 },
  { id: 9003, slug: "fitness", name: "Fitness", displayOrder: 3 },
  { id: 9004, slug: "mindfulness", name: "Mindfulness", displayOrder: 4 },
];

export const seedMedia: ReadonlyArray<SeedMedia> = [
  {
    id: 9001,
    filename: "seed-card-a.webp",
    storageKey: "seed/local/card-a.webp",
    mimeType: "image/webp",
    sizeBytes: 24576,
    width: 768,
    height: 512,
    altText: "Soft morning light over a tidy desk",
  },
  {
    id: 9002,
    filename: "seed-card-b.webp",
    storageKey: "seed/local/card-b.webp",
    mimeType: "image/webp",
    sizeBytes: 22528,
    width: 768,
    height: 512,
    altText: "A pot of vegetables simmering on a stove",
  },
  {
    id: 9003,
    filename: "seed-card-c.webp",
    storageKey: "seed/local/card-c.webp",
    mimeType: "image/webp",
    sizeBytes: 23552,
    width: 768,
    height: 512,
    altText: "Running shoes by an open front door",
  },
];

export const seedSettings: ReadonlyArray<SeedSetting> = [
  { id: 9001, key: "site_name", value: "Seed Local Living" },
  { id: 9002, key: "tagline", value: "Deterministic wellness, every run" },
  {
    id: 9003,
    key: "site_description",
    value:
      "A fixed local fixture site that fills every Home bucket for preview and tests.",
  },
  {
    id: 9004,
    key: "brand_tokens_json",
    value: '{"brand-primary":"#0f8aa6","brand-ink":"#15323a"}',
  },
  {
    id: 9005,
    key: "newsletter_settings_json",
    value:
      '{"heading":"The Seed Local Letter","description":"One deterministic digest. No surprises."}',
  },
];

interface ArticleSpec {
  slug: string;
  title: string;
  categoryId: number;
  isFeatured: 0 | 1;
  isTrending: 0 | 1;
  homepageRank: number | null;
}

// Order matters: index drives id (9101 + i), published_at (one day older
// per row), and media rotation — all deterministic functions of position.
const ARTICLE_SPECS: ReadonlyArray<ArticleSpec> = [
  // 4 featured -> hero + featured[3] + picks[4]
  { slug: "morning-light-rituals", title: "Morning Light Rituals That Stick", categoryId: 9001, isFeatured: 1, isTrending: 0, homepageRank: 1 },
  { slug: "pantry-reset-week", title: "The Pantry Reset: A Week of Steady Meals", categoryId: 9002, isFeatured: 1, isTrending: 0, homepageRank: 2 },
  { slug: "strength-basics-desk-workers", title: "Strength Basics for Busy Desk Workers", categoryId: 9003, isFeatured: 1, isTrending: 0, homepageRank: 3 },
  { slug: "five-minute-breathing-ledger", title: "A Five-Minute Breathing Ledger", categoryId: 9004, isFeatured: 1, isTrending: 0, homepageRank: 4 },
  // 5 trending -> dark strip, TRENDING_LIMIT exactly
  { slug: "hydration-math", title: "Hydration Math for Real Schedules", categoryId: 9002, isFeatured: 0, isTrending: 1, homepageRank: null },
  { slug: "two-block-walk", title: "The Two-Block Walk Experiment", categoryId: 9003, isFeatured: 0, isTrending: 1, homepageRank: null },
  { slug: "quiet-hours-evening", title: "Quiet Hours: Designing a Calmer Evening", categoryId: 9004, isFeatured: 0, isTrending: 1, homepageRank: null },
  { slug: "seasonal-produce-budget", title: "Seasonal Produce on a Fixed Budget", categoryId: 9002, isFeatured: 0, isTrending: 1, homepageRank: null },
  { slug: "stretch-breaks-deadlines", title: "Stretch Breaks That Survive Deadlines", categoryId: 9001, isFeatured: 0, isTrending: 1, homepageRank: null },
  // 6 plain published -> latest
  { slug: "beginner-sleep-ledger", title: "A Beginner Ledger for Better Sleep", categoryId: 9001, isFeatured: 0, isTrending: 0, homepageRank: null },
  { slug: "batch-cooking-burnout", title: "Batch Cooking Without the Burnout", categoryId: 9002, isFeatured: 0, isTrending: 0, homepageRank: null },
  { slug: "form-checks-three-lifts", title: "Form Checks: Three Lifts, Three Cues", categoryId: 9003, isFeatured: 0, isTrending: 0, homepageRank: null },
  { slug: "journaling-foggy-mornings", title: "Journaling Prompts for Foggy Mornings", categoryId: 9004, isFeatured: 0, isTrending: 0, homepageRank: null },
  { slug: "weekend-reset-checklist", title: "The Weekend Reset Checklist", categoryId: 9001, isFeatured: 0, isTrending: 0, homepageRank: null },
  { slug: "walking-meetings-field-guide", title: "Walking Meetings: A Field Guide", categoryId: 9003, isFeatured: 0, isTrending: 0, homepageRank: null },
];

function articleHtml(title: string): string {
  return (
    `<p>${title} is part of the seed:local fixture. The copy is fixed so ` +
    "every seed run renders the same cards, the same excerpts, and the " +
    "same read times on the Home page.</p>" +
    "<p>Use this article to exercise list layouts, category chips, and " +
    "the article template without touching production data.</p>"
  );
}

function articleJson(title: string): string {
  return JSON.stringify({
    blocks: [
      { type: "paragraph", text: `${title} is part of the seed:local fixture.` },
      { type: "paragraph", text: "Fixed copy keeps every seed run identical." },
    ],
  });
}

export const seedArticles: ReadonlyArray<SeedArticle> = ARTICLE_SPECS.map(
  (spec, i) => ({
    id: 9101 + i,
    slug: spec.slug,
    title: spec.title,
    categoryId: spec.categoryId,
    mediaId: seedMedia[i % seedMedia.length]!.id,
    isFeatured: spec.isFeatured,
    isTrending: spec.isTrending,
    homepageRank: spec.homepageRank,
    publishedAt: SEED_EPOCH - (i + 1) * 86400,
    contentHtml: articleHtml(spec.title),
    contentJson: articleJson(spec.title),
  }),
);
