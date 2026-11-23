// X06 SEO Fixes — the AI text layer and new-site setup (plan v3, §3 Part A,
// §8 "Done when"). Runs the REAL setup steps over a real SQLite built from
// every migration (the seeded AI Presets ask for {{audience}}), with a fake AI
// in place of OpenAI. No network, no real AI.
//
// Covers:
//   - a fake AI that repeats its prompt back: the saved Tagline, Site
//     Description, About page and Articles hold no "{{" (fails on the base
//     code: the Site Description preset was sent with "{{audience}}" in it and
//     the echo was saved);
//   - setup copies the Vertical's audience into the site's "audience" setting;
//   - an answer with "{{x}}" is asked for once more, then the fallback is used
//     and the AI log (ai_generations) records it;
//   - an unfilled {{token}} is never sent; the AI log names it;
//   - resuming setup never reuses a saved answer that holds "{{";
//   - Site Description: asked for 120–160 characters, a longer answer is
//     refused and asked for once more, the fallback is under 160;
//   - setup saves the full Article title as seo_title (never cut at 70);
//   - setup's in-article image: the extra instruction stays in the prompt,
//     the saved description (alt) is the Article's title.

import { describe, it, expect, afterEach } from "vitest";
import { STEPS } from "../src/site-provisioning/steps";
import {
  PLACEHOLDER_IN_ANSWER,
  SITE_DESCRIPTION_MAX_CHARS,
  UNFILLED_PLACEHOLDER,
  computeIdempotencyKey,
  generateSiteDescription,
  generateSiteTagline,
} from "../src/ai/generators/text";
import { fallbackSiteDescription } from "../src/ai/generators/fallback";
import { PROMPT_VERSION as TAGLINE_PROMPT_VERSION } from "../src/ai/prompts/site-tagline";
import type { Env } from "../src/env";
import {
  addSite,
  createDb,
  hasSqlite,
  installFakeAi,
  makeEnv,
  type FakeAi,
  type SqliteDb,
} from "./helpers/x06-ai-kit";

const describeDb = hasSqlite ? describe : describe.skip;

const LONG_TITLE =
  "Popular Budgeting Methods Compared: 50/30/20, Zero-Based, Envelope, and More for Busy Families";

// The fake AI "repeats its prompt back" in the shape each task expects, so the
// echoed prompt lands in every saved text field. ("placeholder" is a banned
// word for the Article validator, so the echo swaps it out.)
function echoAnswer(prompt: string): string {
  const echo = prompt.replace(/placeholder/gi, "token");
  if (prompt.includes("article ideas as items")) {
    return JSON.stringify({
      items: Array.from({ length: 15 }, (_, i) => ({
        slug: `echo-guide-${i + 1}`,
        title: i === 0 ? LONG_TITLE : `Echo guide number ${i + 1}`,
        summary: echo,
      })),
    });
  }
  if (prompt.includes("About page")) {
    return JSON.stringify({
      title: "About us",
      body: [
        { type: "p", text: echo },
        { type: "h2", text: "What we cover" },
        { type: "p", text: echo },
      ],
    });
  }
  if (/faq/i.test(prompt)) {
    return JSON.stringify({
      title: LONG_TITLE,
      subtitle: "A short teaser line.",
      intro: echo,
      key_idea: echo,
      sections: [1, 2, 3].map((n) => ({
        heading: { level: 2, text: `Section ${n}` },
        paragraphs: [echo],
        bullets: ["One", "Two"],
      })),
      takeaways: [echo],
      editors_pick: { title: "Start small", why: echo },
      faqs: [1, 2, 3].map((n) => ({ question: `Question ${n}?`, answer: echo })),
    });
  }
  return echo;
}

function ctxFor(env: Env, siteId: string, step_order: number) {
  return { env, db: env.DB, job_id: `job-${siteId}`, site_id: siteId, step_order };
}

async function runToCompletion(
  key: keyof typeof STEPS,
  env: Env,
  siteId: string,
  order: number,
): Promise<string> {
  let r = await STEPS[key](ctxFor(env, siteId, order));
  let guard = 0;
  while (r.status === "in_progress" && guard < 200) {
    r = await STEPS[key](ctxFor(env, siteId, order));
    guard += 1;
  }
  return r.status;
}

function setting(sdb: SqliteDb, siteId: string, key: string): string | null {
  const row = sdb
    .prepare("SELECT value FROM site_settings WHERE site_id = ? AND key = ?")
    .get(siteId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

function aiRow(sdb: SqliteDb, key: string): { status: string; error_message: string | null; parsed_json: string | null } {
  return sdb
    .prepare("SELECT status, error_message, parsed_json FROM ai_generations WHERE idempotency_key = ?")
    .get(key) as { status: string; error_message: string | null; parsed_json: string | null };
}

let fake: FakeAi | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

describeDb("X06 setup: no {{…}} reaches a saved text (fake AI repeats its prompt)", () => {
  it("saved Tagline, Site Description, About page and Articles contain no '{{'; the Vertical's audience is used", async () => {
    const sdb = createDb();
    addSite(sdb, "site-echo", "Money Lantern", "finance");
    // The Tagline preset's FIRST line also asks for {{audience}} (the tagline
    // parser keeps the first line), like an operator-edited preset could.
    sdb
      .prepare(
        "UPDATE prompt_presets SET system_prompt_template = ? WHERE slug = 'system-tagline'",
      )
      .run("Tagline writer for {{brand_name}}, writing for {{audience}}.");
    const env = makeEnv(sdb);
    fake = installFakeAi((p) => echoAnswer(p));

    expect(await runToCompletion("create_site_settings", env, "site-echo", 4)).toBe("completed");
    expect(await runToCompletion("generate_tagline_and_site_description", env, "site-echo", 5)).toBe("completed");
    expect(await runToCompletion("generate_about_page", env, "site-echo", 6)).toBe("completed");
    expect(await runToCompletion("generate_15_homepage_articles", env, "site-echo", 10)).toBe("completed");

    const audience = "people who want to make smarter everyday money decisions";
    // First: nothing saved holds "{{" (on the base code the Site Description
    // and the Tagline were the echoed prompt with "{{audience}}" in it).
    const tagline = setting(sdb, "site-echo", "tagline");
    const description = setting(sdb, "site-echo", "site_description");
    expect(tagline).not.toContain("{{");
    expect(description).not.toContain("{{");
    expect((description ?? "").length).toBeLessThanOrEqual(SITE_DESCRIPTION_MAX_CHARS);

    const about = sdb
      .prepare("SELECT title, content_json, content_html FROM pages WHERE site_id = ? AND slug = 'about'")
      .get("site-echo") as { title: string; content_json: string; content_html: string };
    expect(about).toBeTruthy();
    expect(JSON.stringify(about)).not.toContain("{{");
    expect(about.content_json).toContain(audience);

    const articles = sdb
      .prepare(
        "SELECT title, seo_title, seo_description, subtitle, content_json, content_html FROM articles WHERE site_id = ?",
      )
      .all("site-echo") as Array<Record<string, string | null>>;
    expect(articles).toHaveLength(15);
    for (const a of articles) {
      expect(JSON.stringify(a)).not.toContain("{{");
      expect(JSON.stringify(a)).not.toContain("}}\"");
    }
    // The echoed article text is really there (the AI answer was used).
    expect(articles.some((a) => (a.content_json ?? "").includes(audience))).toBe(true);
    const units = sdb
      .prepare("SELECT title, summary FROM provisioning_article_units WHERE site_id = ?")
      .all("site-echo");
    expect(JSON.stringify(units)).not.toContain("{{");

    // The Vertical's default audience was copied into the site's own setting
    // and filled into every prompt in place of {{audience}}.
    expect(setting(sdb, "site-echo", "audience")).toBe(audience);
    expect(fake.textPrompts.length).toBeGreaterThan(3);
    for (const p of fake.textPrompts) expect(p).not.toContain("{{");
    expect(fake.textPrompts.some((p) => p.includes(audience))).toBe(true);
    expect(tagline).toContain(audience);
  });

  it("setup saves the full Article title as seo_title (a >70-character title is never cut)", async () => {
    const sdb = createDb();
    addSite(sdb, "site-seo", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi((p) => echoAnswer(p));
    await runToCompletion("generate_15_homepage_articles", env, "site-seo", 10);
    const rows = sdb
      .prepare("SELECT title, seo_title FROM articles WHERE site_id = ?")
      .all("site-seo") as Array<{ title: string; seo_title: string }>;
    expect(rows.length).toBe(15);
    expect(LONG_TITLE.length).toBeGreaterThan(70);
    const long = rows.filter((r) => r.title === LONG_TITLE);
    expect(long.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.seo_title).toBe(r.title);
  });

  it("setup's in-article image: the extra instruction stays in the prompt only; the saved alt text is the Article's title", async () => {
    const sdb = createDb();
    addSite(sdb, "site-img", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi((p) => echoAnswer(p));
    await runToCompletion("generate_15_homepage_articles", env, "site-img", 10);
    await runToCompletion("generate_or_assign_article_images", env, "site-img", 11);

    expect(fake.imagePrompts.some((p) => p.includes("a different supporting moment"))).toBe(true);
    const mids = sdb
      .prepare("SELECT storage_key, alt_text FROM media WHERE site_id = ? AND storage_key LIKE '%-mid%'")
      .all("site-img") as Array<{ storage_key: string; alt_text: string }>;
    expect(mids.length).toBeGreaterThan(0);
    const titles = new Set(
      (sdb.prepare("SELECT title FROM articles WHERE site_id = ?").all("site-img") as Array<{ title: string }>).map(
        (r) => r.title,
      ),
    );
    for (const m of mids) {
      expect(m.alt_text).not.toContain("supporting moment");
      expect(titles.has(m.alt_text)).toBe(true);
    }
    const articles = sdb
      .prepare("SELECT title, content_json FROM articles WHERE site_id = ?")
      .all("site-img") as Array<{ title: string; content_json: string }>;
    let filled = 0;
    for (const a of articles) {
      const blocks = (JSON.parse(a.content_json) as { blocks: Array<{ type: string; src?: string; alt?: string }> }).blocks;
      for (const b of blocks) {
        if (b.type === "image" && typeof b.src === "string" && b.src.includes("-mid")) {
          expect(b.alt).toBe(a.title);
          filled += 1;
        }
      }
    }
    expect(filled).toBeGreaterThan(0);
  });
});

describeDb("X06 shared check: bad answers, unfilled tokens, the AI log", () => {
  it("an answer with '{{x}}' is asked for once more, then the fallback is used, and the AI log records it", async () => {
    const sdb = createDb();
    addSite(sdb, "site-bad", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi(() => "Money tips for {{x}}");

    const res = await generateSiteTagline(env, {
      site_id: "site-bad",
      vertical: "finance",
      brand_name: "Money Lantern",
      audience: "savers",
    });
    expect(fake.textPrompts).toHaveLength(2);
    expect(res.status).toBe("fallback");
    expect(res.parsed.tagline).not.toContain("{{");
    const row = aiRow(sdb, res.idempotency_key);
    expect(row.status).toBe("fallback");
    expect(row.error_message).toContain(PLACEHOLDER_IN_ANSWER);
    expect(row.parsed_json).not.toContain("{{");
  });

  it("a second, clean answer is used (status success, two AI calls)", async () => {
    const sdb = createDb();
    addSite(sdb, "site-retry", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi((_p, n) => (n === 1 ? "Guides for }} readers" : "Light your path to smarter money"));
    const res = await generateSiteTagline(env, {
      site_id: "site-retry",
      vertical: "finance",
      brand_name: "Money Lantern",
    });
    expect(fake.textPrompts).toHaveLength(2);
    expect(res.status).toBe("success");
    expect(res.parsed.tagline).toBe("Light your path to smarter money");
  });

  it("a {{token}} nobody can fill is never sent; the AI log names it and the fallback is returned", async () => {
    const sdb = createDb();
    addSite(sdb, "site-unfilled", "Money Lantern", "finance");
    sdb
      .prepare("UPDATE prompt_presets SET user_prompt_template = ? WHERE slug = 'system-tagline'")
      .run("Write a tagline for {{brand_name}} in the voice of {{mascot_name}}.");
    const env = makeEnv(sdb);
    fake = installFakeAi(() => "should never be asked");
    const res = await generateSiteTagline(env, {
      site_id: "site-unfilled",
      vertical: "finance",
      brand_name: "Money Lantern",
    });
    expect(fake.textPrompts).toHaveLength(0);
    expect(res.status).toBe("fallback");
    expect(res.parsed.tagline).not.toContain("{{");
    const row = aiRow(sdb, res.idempotency_key);
    expect(row.status).toBe("fallback");
    expect(row.error_message).toContain(UNFILLED_PLACEHOLDER);
    expect(row.error_message).toContain("mascot_name");
  });

  it("missing audience is filled from the site (its setting, else its Vertical) before the AI is asked", async () => {
    const sdb = createDb();
    addSite(sdb, "site-fill", "Money Lantern", "finance");
    sdb
      .prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, 'audience', ?)")
      .run("site-fill", "first-time home buyers");
    const env = makeEnv(sdb);
    fake = installFakeAi(() => "Your first home, made simple");
    const res = await generateSiteTagline(env, {
      site_id: "site-fill",
      vertical: "finance",
      brand_name: "Money Lantern",
      presetCategory: "tagline",
    });
    expect(res.status).toBe("success");
    expect(fake.textPrompts[0]).toContain("first-time home buyers");
    expect(fake.textPrompts[0]).not.toContain("{{");
  });
});

describeDb("X06 resume: a saved bad answer is never reused", () => {
  it("re-running the Tagline step asks the AI again when the saved answer holds '{{', and saves a clean one", async () => {
    const sdb = createDb();
    addSite(sdb, "site-resume", "Money Lantern", "finance");
    const key = computeIdempotencyKey("site-resume", "site-tagline", TAGLINE_PROMPT_VERSION, "site-resume");
    sdb
      .prepare(
        "INSERT INTO ai_generations (id, site_id, task, provider, model, prompt_version, idempotency_key, " +
          "request_json, response_json, parsed_json, status, target_type, target_id, error_message, created_at, updated_at) " +
          "VALUES ('gen-old', 'site-resume', 'site-tagline', 'openai', 'gpt-5.5', ?, ?, NULL, NULL, ?, 'success', 'site_settings', 'site-resume', NULL, 1, 1)",
      )
      .run(TAGLINE_PROMPT_VERSION, key, JSON.stringify({ tagline: "Smart money for {{audience}}" }));
    const env = makeEnv(sdb);
    fake = installFakeAi((p) =>
      p.includes("120 to 160") ? "Clear guides on saving, credit and loans for people who want to make smarter everyday money decisions." : "Light your path to smarter money",
    );
    await runToCompletion("generate_tagline_and_site_description", env, "site-resume", 5);
    expect(setting(sdb, "site-resume", "tagline")).toBe("Light your path to smarter money");
    const row = aiRow(sdb, key);
    expect(row.status).toBe("success");
    expect(row.parsed_json).not.toContain("{{");
    // The same row was reused (no duplicate receipt).
    const n = sdb
      .prepare("SELECT COUNT(*) AS n FROM ai_generations WHERE idempotency_key = ?")
      .get(key) as { n: number };
    expect(Number(n.n)).toBe(1);
  });

  it("a clean saved answer is still reused on resume (no new AI call)", async () => {
    const sdb = createDb();
    addSite(sdb, "site-reuse", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi(() => "Light your path to smarter money");
    const first = await generateSiteTagline(env, { site_id: "site-reuse", vertical: "finance", brand_name: "Money Lantern" });
    const second = await generateSiteTagline(env, { site_id: "site-reuse", vertical: "finance", brand_name: "Money Lantern" });
    expect(fake.textPrompts).toHaveLength(1);
    expect(second.ai_generation_id).toBe(first.ai_generation_id);
    expect(second.parsed.tagline).toBe("Light your path to smarter money");
  });
});

describeDb("X06 Site Description length", () => {
  const LONG = "Money Lantern ".repeat(15).trim(); // > 160 characters
  const GOOD =
    "Clear, practical guides on budgeting, saving, credit and loans for people who want to make smarter everyday money decisions.";

  it("asks for 120–160 characters; a longer answer is refused and asked for once more", async () => {
    const sdb = createDb();
    addSite(sdb, "site-len", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi((_p, n) => (n === 1 ? LONG : GOOD));
    expect(LONG.length).toBeGreaterThan(SITE_DESCRIPTION_MAX_CHARS);
    const res = await generateSiteDescription(env, {
      site_id: "site-len",
      vertical: "finance",
      brand_name: "Money Lantern",
      presetCategory: "site-description",
    });
    expect(fake.textPrompts).toHaveLength(2);
    expect(fake.textPrompts[0]).toContain("120 to 160 characters");
    expect(res.status).toBe("success");
    expect(res.parsed.description).toBe(GOOD);
  });

  it("two too-long answers → the fallback, which is under 160 characters", async () => {
    const sdb = createDb();
    addSite(sdb, "site-len2", "Money Lantern", "finance");
    const env = makeEnv(sdb);
    fake = installFakeAi(() => LONG);
    const res = await generateSiteDescription(env, {
      site_id: "site-len2",
      vertical: "finance",
      brand_name: "Money Lantern",
    });
    expect(fake.textPrompts).toHaveLength(2);
    expect(res.status).toBe("fallback");
    expect(res.parsed.description.length).toBeLessThan(160);
    expect(aiRow(sdb, res.idempotency_key).error_message).toContain("SITE_DESCRIPTION_TOO_LONG");
  });

  it("the fallback Site Description stays under 160 characters even for long names", () => {
    for (const [brand, vertical] of [
      ["Money Lantern", "finance"],
      ["Thecontentandcareer", "jobs"],
      ["A".repeat(90), "personal-finance-and-everyday-money-decisions-for-families"],
      ["Word ".repeat(60).trim(), "finance"],
    ]) {
      const d = fallbackSiteDescription({ site_id: "s", vertical: vertical!, brand_name: brand });
      expect(d.length).toBeLessThan(160);
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain("{{");
    }
  });
});
