// X06 SEO Fixes — POST /api/admin/ai/site-text, the endpoint behind
// Settings → General "✨ Write with AI" (Tagline / Site Description).
// Runs the REAL admin router over a real SQLite built from every migration,
// with a fake AI in place of OpenAI (no network, no real AI).
//
// Contract: 200 { text } (no "{{", a Site Description ≤ 160 characters);
// 400 { error } for bad site_id / field; 404 { error: "Unknown site_id" };
// 502 { error: "The AI didn't answer. Nothing was changed." } when the AI
// fails or only the fallback would come back. It never saves a setting.

import { describe, it, expect, afterEach } from "vitest";
import admin from "../src/admin/router";
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
const FAILED = "The AI didn't answer. Nothing was changed.";
const GOOD_DESCRIPTION =
  "Clear, practical guides on budgeting, saving, credit and loans for people who want to make smarter everyday money decisions.";

let fake: FakeAi | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

async function post(env: Env, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await admin.request(
    "/api/admin/ai/site-text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function seedSite(sdb: SqliteDb): void {
  addSite(sdb, "site-ml", "moneylantern", "finance");
  const put = sdb.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  put.run("site-ml", "site_name", "Money Lantern");
  put.run("site-ml", "tagline", "Light your path to smarter money.");
  put.run("site-ml", "site_description", "The saved description.");
  for (let i = 1; i <= 6; i++) {
    sdb
      .prepare(
        "INSERT INTO articles (site_id, slug, title, content_json, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, '{}', 'published', ?, ?)",
      )
      .run("site-ml", `post-${i}`, `Article number ${i}`, 1000 + i, 1000 + i);
  }
}

function settingsSnapshot(sdb: SqliteDb): string {
  return JSON.stringify(
    sdb.prepare("SELECT site_id, key, value FROM site_settings ORDER BY site_id, key").all(),
  );
}

describeDb("X06 POST /api/admin/ai/site-text — 400 / 404", () => {
  it("400 for a bad body, a missing site_id or an unknown field; the AI is never asked", async () => {
    const sdb = createDb();
    seedSite(sdb);
    const env = makeEnv(sdb);
    fake = installFakeAi(() => "never");
    for (const body of [
      "not json",
      [],
      { field: "tagline" },
      { site_id: "", field: "tagline" },
      { site_id: "site-ml" },
      { site_id: "site-ml", field: "site_name" },
    ]) {
      const r = await post(env, body);
      expect(r.status).toBe(400);
      expect(typeof r.json.error).toBe("string");
    }
    expect(fake.textPrompts).toHaveLength(0);
  });

  it("404 { error: 'Unknown site_id' } for a site that doesn't exist", async () => {
    const sdb = createDb();
    const env = makeEnv(sdb);
    fake = installFakeAi(() => "never");
    const r = await post(env, { site_id: "nope", field: "tagline" });
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: "Unknown site_id" });
    expect(fake.textPrompts).toHaveLength(0);
  });
});

describeDb("X06 POST /api/admin/ai/site-text — 200", () => {
  it("tagline: uses the form's Site Name and Audience, the Vertical and the 5 newest Article titles; saves nothing", async () => {
    const sdb = createDb();
    seedSite(sdb);
    const env = makeEnv(sdb);
    const before = settingsSnapshot(sdb);
    fake = installFakeAi(() => "Smarter money, one clear guide at a time");
    const r = await post(env, {
      site_id: "site-ml",
      field: "tagline",
      site_name: "Money Lantern Pro",
      audience: "first-time savers",
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ text: "Smarter money, one clear guide at a time" });
    const prompt = fake.textPrompts[0] ?? "";
    expect(prompt).toContain("Money Lantern Pro");
    expect(prompt).toContain("first-time savers");
    expect(prompt).toContain("Finance");
    expect(prompt).not.toContain("{{");
    for (let i = 2; i <= 6; i++) expect(prompt).toContain(`Article number ${i}`);
    expect(prompt).not.toContain(`"Article number 1"`);
    expect(settingsSnapshot(sdb)).toBe(before);
  });

  it("site_description: empty form values fall back to the saved Site Name and the site's audience; text ≤ 160; saves nothing", async () => {
    const sdb = createDb();
    seedSite(sdb);
    const env = makeEnv(sdb);
    const before = settingsSnapshot(sdb);
    fake = installFakeAi(() => GOOD_DESCRIPTION);
    const r = await post(env, { site_id: "site-ml", field: "site_description", site_name: " ", audience: "" });
    expect(r.status).toBe(200);
    expect(r.json.text).toBe(GOOD_DESCRIPTION);
    expect((r.json.text as string).length).toBeLessThanOrEqual(160);
    const prompt = fake.textPrompts[0] ?? "";
    expect(prompt).toContain("Money Lantern");
    expect(prompt).toContain("people who want to make smarter everyday money decisions");
    expect(prompt).toContain("120 to 160 characters");
    expect(settingsSnapshot(sdb)).toBe(before);
  });

  it("every click asks the AI again (a saved answer is never handed back)", async () => {
    const sdb = createDb();
    seedSite(sdb);
    const env = makeEnv(sdb);
    fake = installFakeAi((_p, n) => `Suggestion number ${n}`);
    const a = await post(env, { site_id: "site-ml", field: "tagline" });
    const b = await post(env, { site_id: "site-ml", field: "tagline" });
    expect(a.json.text).toBe("Suggestion number 1");
    expect(b.json.text).toBe("Suggestion number 2");
    expect(fake.textPrompts).toHaveLength(2);
  });

  it("a first answer with '{{' is asked for once more; the clean second one is returned", async () => {
    const sdb = createDb();
    seedSite(sdb);
    const env = makeEnv(sdb);
    fake = installFakeAi((_p, n) => (n === 1 ? "Money tips for {{audience}}" : "Money tips that make sense"));
    const r = await post(env, { site_id: "site-ml", field: "tagline" });
    expect(r.status).toBe(200);
    expect(r.json.text).toBe("Money tips that make sense");
  });
});

describeDb("X06 POST /api/admin/ai/site-text — 502, never fallback text", () => {
  async function expect502(answer: Parameters<typeof installFakeAi>[0], withKey = true, field = "tagline") {
    const sdb = createDb();
    seedSite(sdb);
    const env = makeEnv(sdb, withKey);
    const before = settingsSnapshot(sdb);
    fake = installFakeAi(answer);
    const r = await post(env, { site_id: "site-ml", field });
    expect(r.status).toBe(502);
    expect(r.json).toEqual({ error: FAILED });
    expect(settingsSnapshot(sdb)).toBe(before);
    fake.restore();
    fake = null;
  }

  it("the AI request fails", async () => {
    await expect502(() => ({ status: 400 }));
  });

  it("no AI key (only the fallback could come back)", async () => {
    await expect502(() => "never", false);
  });

  it("the AI answers with '{{x}}' twice", async () => {
    await expect502(() => "Guides for {{x}}");
  });

  it("the Site Description is over 160 characters twice", async () => {
    await expect502(() => "Money Lantern ".repeat(15).trim(), true, "site_description");
  });
});
