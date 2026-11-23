// X06 SEO Fixes, Part B fix 4: the hero image "✨" window.
//
// Client (the real ES5 hero script, run in node:vm over the real card HTML):
//   - the request's alt_text is the open Article's title, never the prompt;
//   - "{{title}}", "{{brand_name}}" and "{{vertical}}" are filled from the
//     open Article before the request is sent (typed prompt and preset path);
//   - a prompt with a placeholder that can't be filled is not sent.
// Server (the real POST /api/admin/ai/image route, fake AI + fake D1):
//   - the saved media alt_text is never the prompt and never holds "{{".

import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";
import { heroImageScripts, renderHeroImageCard } from "../src/admin/templates/hero-image";
import { pickAltText } from "../src/admin/ai-image";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

const ARTICLE_TITLE = "How to Build an Emergency Fund on a Tight Budget";

// mini-dom has no select.options / selectedIndex / option.text; add them.
function patchSelect(sel: MiniNode, labels: Record<string, string>): void {
  const opts = () => sel.querySelectorAll("option");
  for (const o of opts()) (o as unknown as { text: string }).text = labels[o.value] ?? "";
  Object.defineProperty(sel, "options", { get: opts });
  Object.defineProperty(sel, "selectedIndex", {
    get: () => opts().findIndex((o) => o.value === sel.value),
  });
}

function bootHero(opts: { title?: string; presets?: unknown[] } = {}) {
  const html = `<form id="article-form">
    <input id="article-title" name="title" value="${opts.title ?? ARTICLE_TITLE}" />
    <select name="site_id"><option value="site-1" data-vertical="finance" selected>Money Lantern</option></select>
    <select name="vertical_id"><option value="" selected>Same as site</option></select>
    ${renderHeroImageCard()}
  </form>`;
  const doc = miniDocument(html);
  patchSelect(doc.querySelector('select[name="site_id"]') as MiniNode, { "site-1": "Money Lantern" });
  patchSelect(doc.querySelector('select[name="vertical_id"]') as MiniNode, { "": "Same as site" });
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const fetchStub = (url: string, init?: { body?: unknown }) => {
    calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    let body: unknown = {};
    if (url.indexOf("/api/admin/ai/presets") > -1) body = { items: opts.presets ?? [] };
    if (url.indexOf("/api/admin/ai/image") > -1) {
      body = { ok: true, model: "gpt-image-2", media_id: 5, image_url: "/media/x.png" };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  runInNewContext(heroImageScripts, { document: doc, fetch: fetchStub, FormData: class {}, Object, String });
  const el = (id: string) => doc.getElementById(id) as MiniNode;
  const imageCalls = () => calls.filter((c) => c.url.indexOf("/api/admin/ai/image") > -1);
  return { doc, el, imageCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("X06 hero image window (client)", () => {
  it("alt_text is the Article title, not the prompt; tokens are filled before sending", async () => {
    const { el, imageCalls } = bootHero();
    el("hero-image-ai-generate").click();
    await flush();
    el("hero-ai-prompt").value = "Editorial photo for {{title}} on {{brand_name}}, a {{vertical}} site";
    el("hero-ai-generate-btn").click();
    await flush();
    expect(imageCalls()).toHaveLength(1);
    const sent = imageCalls()[0]!.body!;
    expect(sent["prompt"]).toBe(
      `Editorial photo for ${ARTICLE_TITLE} on Money Lantern, a finance site`,
    );
    expect(sent["alt_text"]).toBe(ARTICLE_TITLE);
    expect(sent["alt_text"]).not.toBe(sent["prompt"]);
    expect(sent["title"]).toBe(ARTICLE_TITLE);
    expect(JSON.stringify(sent)).not.toContain("{{");
  });

  it("a preset's {{title}} is filled from the Article when its box is left empty", async () => {
    const { el, imageCalls } = bootHero({
      presets: [{ id: 3, name: "Hero", slug: "hero", is_active: 1, user_prompt_template: "A calm photo about {{title}}" }],
    });
    el("hero-image-ai-generate").click();
    await flush();
    el("hero-ai-preset").value = "3";
    el("hero-ai-preset").fire("change");
    expect(el("hero-ai-prompt").value).toBe(`A calm photo about ${ARTICLE_TITLE}`);
    el("hero-ai-generate-btn").click();
    await flush();
    const sent = imageCalls()[0]!.body!;
    expect(sent["prompt"]).toBe(`A calm photo about ${ARTICLE_TITLE}`);
    expect((sent["variables"] as Record<string, string>)["title"]).toBe(ARTICLE_TITLE);
    expect(sent["alt_text"]).toBe(ARTICLE_TITLE);
  });

  it("a placeholder that can't be filled stops the request with a plain error", async () => {
    const { el, imageCalls } = bootHero({ title: "" });
    el("hero-image-ai-generate").click();
    await flush();
    el("hero-ai-prompt").value = "A photo for {{title}}";
    el("hero-ai-generate-btn").click();
    await flush();
    expect(imageCalls()).toHaveLength(0);
    expect(el("hero-ai-error").hidden).toBe(false);
    expect(el("hero-ai-error").textContent).toContain("{{title}}");
  });

  it("no Article title → no alt_text is sent (the server then saves an empty description)", async () => {
    const { el, imageCalls } = bootHero({ title: "" });
    el("hero-image-ai-generate").click();
    await flush();
    el("hero-ai-prompt").value = "A sunny kitchen";
    el("hero-ai-generate-btn").click();
    await flush();
    const sent = imageCalls()[0]!.body!;
    expect(sent["alt_text"]).toBeUndefined();
  });
});

// ---- Server: what /api/admin/ai/image saves as the image description ----

function makeServerDb() {
  const mediaAlts: unknown[] = [];
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.startsWith("INSERT INTO media")) {
          mediaAlts.push(captured[4]);
          return { id: 7 } as T;
        }
        if (sql.includes("FROM ai_generations")) {
          return { id: "gen-1", status: "pending" } as T;
        }
        return null;
      },
      async run() {
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, mediaAlts };
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: { async put() { return null; } } as unknown as R2Bucket,
    APP_ENV: "development",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    OPENAI_API_KEY: "sk-test",
  } as Env;
}

function stubFakeImageAi() {
  const png = Buffer.from("fake-png-bytes").toString("base64");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 })),
  );
}

async function savedAlt(body: Record<string, unknown>): Promise<unknown> {
  const { db, mediaAlts } = makeServerDb();
  stubFakeImageAi();
  const res = await admin.request(
    "/api/admin/ai/image",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    buildEnv(db),
  );
  expect(res.status).toBe(200);
  expect(mediaAlts).toHaveLength(1);
  return mediaAlts[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("X06 /api/admin/ai/image never saves the prompt as the image description", () => {
  const PROMPT = "Editorial photo for {{title}}, warm light";

  it("alt_text equal to the prompt → the Article title is saved", async () => {
    expect(await savedAlt({ prompt: "A warm kitchen", alt_text: "A warm kitchen", title: ARTICLE_TITLE })).toBe(
      ARTICLE_TITLE,
    );
  });

  it("alt_text with a placeholder → the Article title is saved", async () => {
    expect(await savedAlt({ prompt: PROMPT, alt_text: PROMPT, title: ARTICLE_TITLE })).toBe(ARTICLE_TITLE);
  });

  it("no alt_text and no title → an empty description, not the prompt", async () => {
    const alt = await savedAlt({ prompt: "A warm kitchen" });
    expect(alt).toBe("");
  });

  it("a title with a placeholder is not used either", async () => {
    const alt = await savedAlt({ prompt: "A warm kitchen", title: "{{title}}" });
    expect(alt).toBe("");
  });

  it("a real alt_text is kept as given", async () => {
    expect(await savedAlt({ prompt: "A warm kitchen", alt_text: "Kitchen at sunrise", title: ARTICLE_TITLE })).toBe(
      "Kitchen at sunrise",
    );
  });

  it("pickAltText never returns the prompt or a '{{' text", () => {
    const cases: Array<Record<string, unknown>> = [
      {},
      { alt_text: PROMPT },
      { alt_text: "  " + PROMPT + " " },
      { alt_text: "x {{brand_name}}" },
      { title: "{{title}}" },
      { alt_text: PROMPT, title: "a }} b" },
    ];
    for (const body of cases) {
      const alt = pickAltText(body, PROMPT);
      expect(alt).not.toBe(PROMPT);
      expect(alt).not.toContain("{{");
    }
  });
});
