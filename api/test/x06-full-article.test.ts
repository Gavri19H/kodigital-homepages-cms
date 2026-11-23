// X06 SEO Fixes, Part B fix 3 + Part C titles: "✨ Generate" → "Full article".
//
// Runs the REAL POST /api/admin/ai/article handler and the REAL text
// generator. The only fakes are the database (a small in-memory stand-in) and
// the AI itself (global fetch is stubbed; nothing leaves the machine).
//
//   - The AI failing (error, garbage answer, no key) → 502 with the exact
//     message, no fields, and the operator's instructions appear nowhere.
//   - A long title stays whole in seo_title; a long intro gives a Google
//     description of at most 160 characters ending on a whole word.
//   - An empty "Audience" field → the site's audience reaches the AI prompt.
//   - {site_id, lookup:"audience"} returns the site's audience (panel prefill).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cutAtWholeWord, generateFullArticle } from "../src/admin/ai-article";

const SITE_AUDIENCE = "people who want to make smarter everyday money decisions";
const BRIEF = "Write it for first-time savers, mention emergency funds.";
const FAILED = "The AI didn't answer. Nothing was changed. Try again.";

function fakeDb(opts: { siteAudience?: string | null } = {}) {
  const generations = new Map<string, Record<string, unknown>>();
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        binds = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.includes("FROM ai_generations")) {
          return (generations.get(String(binds[0])) ?? null) as T | null;
        }
        if (sql.includes("FROM sites")) {
          return { id: "site-1", name: "Money Lantern", vertical_slug: "finance" } as T;
        }
        if (sql.includes("FROM site_settings") && sql.includes("'audience'")) {
          return (opts.siteAudience === null
            ? null
            : { value: opts.siteAudience ?? SITE_AUDIENCE }) as T | null;
        }
        if (sql.includes("FROM verticals")) {
          return { name: "Finance", audience: "finance vertical readers" } as T;
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO ai_generations")) {
          generations.set(String(binds[6]), {
            id: binds[0],
            site_id: binds[1],
            task: binds[2],
            provider: binds[3],
            model: binds[4],
            prompt_version: binds[5],
            idempotency_key: binds[6],
            request_json: binds[7],
            status: "pending",
          });
        }
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function fakeContext(body: unknown, env: Record<string, unknown>) {
  let jsonBody: unknown = null;
  let statusCode = 200;
  const c = {
    env,
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

function env(db: D1Database, withKey = true): Record<string, unknown> {
  return {
    DB: db,
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    ...(withKey ? { OPENAI_API_KEY: "sk-test" } : {}),
  };
}

const LONG_TITLE =
  "Popular Budgeting Methods Compared: 50/30/20, Zero-Based, Envelope, and Pay-Yourself-First";
const LONG_INTRO =
  "Budgeting sounds simple until you actually sit down with your bank statements and try to decide " +
  "which of the many popular methods fits the way you earn, spend and save money every single month of the year.";

function aiArticle() {
  const section = (n: number) => ({
    heading: { level: 2, text: `How method ${n} works in real life` },
    paragraphs: [`Method ${n} one.`, `Method ${n} two.`, `Method ${n} three.`],
    bullets: [`Point ${n}a`, `Point ${n}b`, `Point ${n}c`],
  });
  return {
    title: LONG_TITLE,
    subtitle: "Pick the budget you will actually stick with.",
    intro: `${LONG_INTRO}\n\nA second intro paragraph.`,
    key_idea: "The best budget is the one you keep.",
    sections: [section(1), section(2), section(3), section(4)],
    takeaways: ["One", "Two", "Three", "Four"],
    editors_pick: { title: "A simple spreadsheet", why: "It is free." },
    faqs: [
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
      { question: "Q3?", answer: "A3." },
    ],
  };
}

// The fake AI. Records every prompt it is sent.
function stubAi(mode: "ok" | "http-error" | "garbage" | "no-intro") {
  const prompts: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const sent = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    prompts.push((sent.messages ?? []).map((m) => m.content ?? "").join("\n"));
    if (mode === "http-error") {
      return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
    }
    let content: string;
    if (mode === "garbage") content = "Sorry, I can't help with that.";
    else if (mode === "no-intro") {
      const a = aiArticle() as Record<string, unknown>;
      delete a["intro"];
      content = JSON.stringify(a);
    } else content = JSON.stringify(aiArticle());
    return new Response(
      JSON.stringify({ model: "gpt-5.5", choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { prompts, fetchMock };
}

function request(extra: Record<string, unknown> = {}) {
  return {
    site_id: "site-1",
    title: "Budgeting methods",
    brief: BRIEF,
    audience: "",
    tone: "friendly",
    length: "long",
    images: { hero: false, mid: false },
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("X06 Full article: a failed AI run fills nothing", () => {
  for (const mode of ["http-error", "garbage"] as const) {
    it(`AI ${mode} → 502 with the exact message and no fields`, async () => {
      stubAi(mode);
      const t = fakeContext(request(), env(fakeDb()));
      await generateFullArticle(t.c);
      const { status, body } = t.result();
      expect(status).toBe(502);
      expect(body).toEqual({ error: FAILED });
      expect(body["fields"]).toBeUndefined();
      expect(body["content_json"]).toBeUndefined();
    });

    it(`AI ${mode} → the operator's instructions appear nowhere in the response`, async () => {
      stubAi(mode);
      const t = fakeContext(request(), env(fakeDb()));
      await generateFullArticle(t.c);
      const text = JSON.stringify(t.result().body);
      expect(text).not.toContain(BRIEF);
      expect(text).not.toContain("Structure requirements");
    });
  }

  it("no AI key → 502 with the exact message (the fallback body is never returned)", async () => {
    const { fetchMock } = stubAi("ok");
    const t = fakeContext(request(), env(fakeDb(), false));
    await generateFullArticle(t.c);
    expect(t.result().status).toBe(502);
    expect(t.result().body).toEqual({ error: FAILED });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a real answer with no intro never uses the instructions as the intro", async () => {
    stubAi("no-intro");
    const t = fakeContext(request(), env(fakeDb()));
    await generateFullArticle(t.c);
    const { status, body } = t.result();
    expect(status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).not.toContain(BRIEF);
    expect(text).not.toContain("Structure requirements");
  });
});

describe("X06 Full article: titles and Google descriptions are never cut mid-word", () => {
  it("a title longer than 70 characters stays whole in seo_title", async () => {
    stubAi("ok");
    const t = fakeContext(request(), env(fakeDb()));
    await generateFullArticle(t.c);
    const fields = t.result().body["fields"] as Record<string, string>;
    expect(LONG_TITLE.length).toBeGreaterThan(70);
    expect(fields["seo_title"]).toBe(LONG_TITLE);
  });

  it("a long intro gives a seo_description of at most 160 characters ending on a whole word", async () => {
    stubAi("ok");
    const t = fakeContext(request(), env(fakeDb()));
    await generateFullArticle(t.c);
    const desc = (t.result().body["fields"] as Record<string, string>)["seo_description"]!;
    expect(LONG_INTRO.length).toBeGreaterThan(160);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc.endsWith("…")).toBe(true);
    const words = desc.slice(0, -1);
    // Every kept word is a whole word of the intro, in order.
    expect(LONG_INTRO.startsWith(words)).toBe(true);
    // The next intro character is a space or punctuation, never a letter.
    expect(LONG_INTRO.charAt(words.length)).toMatch(/[\s,;:.]/);
    expect(words).toMatch(/[a-z]$/);
  });

  it("cutAtWholeWord: short text unchanged; long text ≤160 on a word boundary", () => {
    expect(cutAtWholeWord("Short and sweet.")).toBe("Short and sweet.");
    const exact = "a".repeat(160);
    expect(cutAtWholeWord(exact)).toBe(exact);
    const long = "word ".repeat(60).trim(); // 299 chars
    const cut = cutAtWholeWord(long);
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut).toMatch(/^(word )*word…$/);
  });
});

describe("X06 Full article: the site's audience", () => {
  it("an empty Audience field → the site's audience is in the prompt sent to the AI", async () => {
    const { prompts } = stubAi("ok");
    const t = fakeContext(request({ audience: "" }), env(fakeDb()));
    await generateFullArticle(t.c);
    expect(t.result().status).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(SITE_AUDIENCE);
    expect(prompts[0]).not.toContain("{{");
  });

  it("no site audience set → the Vertical's default audience is used", async () => {
    const { prompts } = stubAi("ok");
    const t = fakeContext(request({ audience: "" }), env(fakeDb({ siteAudience: null })));
    await generateFullArticle(t.c);
    expect(prompts[0]).toContain("finance vertical readers");
  });

  it("a typed audience wins over the site's", async () => {
    const { prompts } = stubAi("ok");
    const t = fakeContext(request({ audience: "retirees on a fixed income" }), env(fakeDb()));
    await generateFullArticle(t.c);
    expect(prompts[0]).toContain("retirees on a fixed income");
    expect(prompts[0]).not.toContain(SITE_AUDIENCE);
  });

  it("{site_id, lookup:'audience'} returns the site's audience without calling the AI", async () => {
    const { fetchMock } = stubAi("ok");
    const t = fakeContext({ site_id: "site-1", lookup: "audience" }, env(fakeDb()));
    await generateFullArticle(t.c);
    expect(t.result().status).toBe(200);
    expect(t.result().body).toEqual({ audience: SITE_AUDIENCE });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
