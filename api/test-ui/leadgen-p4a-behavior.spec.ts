// P4a LIVE behavior legs (register PC-A1 render fallback + PC-A13 visibility).
//
// A4 (PC-A1 un-stick): a PRE-EXISTING legacy section with continue_mode=
// auto_advance + 2 answer components would strand the visitor (no Continue is
// suppressed by auto_advance, and the engine only auto-advances a SINGLE visible
// interactive). The save gate blocks authoring this NOW, so the legacy row is
// injected by a direct D1 UPDATE (bypassing validation) AFTER a valid button-mode
// create — exactly the "pre-existing content" case. The render fallback
// (planContinueRender) must render ONE Continue, and clicking it must advance;
// answering the questions must NOT auto-advance (the stuck condition).
//
// A5 (PC-A13): a conditional NON-producing node (TextBlock + TrustBar) must hide
// LIVE until its condition is met — the runtime toggles the [data-lg-node] hook
// the presets now emit, converging with the SSR dependency-preview.
//
// Seeds a real ACTIVE tenant + activated funnel through the REAL admin APIs
// (the leadgen-runtime.spec pattern); the tenant host resolves to 127.0.0.1.
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p4a";

function d1Local(command: string): void {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--command", command],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
}

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Seeded { host: string; slug: string; variantId: string; sectionIds: Record<string, number>; sectionPubs: Record<string, string>; }

// Seed an activated funnel from a map of { key -> section body }. Sections are
// attached to the single variant in the given order.
async function seedFunnel(request: APIRequestContext, tag: string, sections: Array<{ key: string; body: Record<string, unknown> }>): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lg-p4a-${tag}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P4a ${tag} ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P4a ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const sectionIds: Record<string, number> = {};
  const sectionPubs: Record<string, string> = {};
  const attach: Array<{ section_id: number }> = [];
  for (const s of sections) {
    const created = await json<{ id: number; public_id: string }>(
      await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...s.body } }),
      `section ${s.key}`,
    );
    sectionIds[s.key] = created.id;
    sectionPubs[s.key] = created.public_id;
    attach.push({ section_id: created.id });
  }
  await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: attach } }), "variant sections");
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
  return { host, slug: tag, variantId, sectionIds, sectionPubs };
}

const choice = (v: string) => ({ label: v.toUpperCase(), value: v, analytics_id: v });
const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

test.beforeAll(() => { mkdirSync(SHOT_DIR, { recursive: true }); });

test.describe("A4 PC-A1 — a legacy auto_advance + 2-component section un-sticks via the rendered Continue", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "stuck", [
      {
        key: "A",
        body: {
          section_name: "Stuck section", headline_text: "Two questions, no Continue?",
          // TWO producers → INELIGIBLE for auto_advance. Non-required so a Continue
          // click advances without needing every answer (isolates the un-stick).
          content_json: JSON.stringify({ components: [
            { type: "ButtonAnswerGroup", question_id: "q1", internal_field: "a1", choices: [choice("x"), choice("y")] },
            { type: "TwoButtonYesNo", question_id: "q2", internal_field: "a2" },
          ] }),
        },
      },
      {
        key: "B",
        body: {
          section_name: "Next section", headline_text: "You made it to step 2",
          content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q3", internal_field: "a3" }] }),
        },
      },
    ]);
    // Inject the LEGACY stuck state the save gate now forbids: flip section A to
    // auto_advance directly in D1 (the resolver reads live section rows).
    d1Local(`UPDATE leadgen_sections SET continue_mode='auto_advance' WHERE public_id='${seeded.sectionPubs["A"]}';`);
    await ctx.dispose();
  });

  test("the served shell renders a Continue for the ineligible auto_advance section (fallback)", async () => {
    const ctx = await playwrightRequest.newContext();
    const served = await ctx.get(`${ORIGIN}/lg/${seeded.slug}`, { headers: { Host: `${seeded.host}:${PW_PORT}` } });
    expect(served.status()).toBe(200);
    const html = await served.text();
    // The stuck section is section 0; the fallback must have emitted a Continue.
    expect(html).toContain("data-lg-continue");
    await ctx.dispose();
  });

  test("answering does NOT auto-advance, but the fallback Continue DOES (section_index 0 -> 1)", async ({ page }) => {
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });

    const sectionIndex = () => page.evaluate(() => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index);
    expect(await sectionIndex()).toBe(0);

    // Answer a choice — a 2-producer auto_advance section must NOT auto-advance.
    await page.locator('[data-lg-index="0"] [data-lg-choice="x"]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(), "answering a 2-component auto_advance section must NOT auto-advance").toBe(0);

    // The fallback Continue un-sticks the funnel.
    const cont = page.locator('[data-lg-index="0"] [data-lg-continue]').first();
    await expect(cont).toBeVisible();
    await cont.click();
    await expect.poll(sectionIndex, { timeout: 5_000 }).toBe(1);
    await page.screenshot({ path: `${SHOT_DIR}/unstuck-step2.png`, fullPage: true });
  });
});

test.describe("A5 PC-A13 — a conditional TextBlock + TrustBar hide/reveal LIVE", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "cond", [
      {
        key: "A",
        body: {
          section_name: "Conditional reveal", headline_text: "Are you covered?",
          content_json: JSON.stringify({ components: [
            { type: "ButtonAnswerGroup", question_id: "q1", internal_field: "cov", choices: [choice("yes"), choice("no")] },
            { type: "TextBlock", question_id: "tb", props: { role: "body", text: "Great — shown only when covered = yes." }, conditional: { when: "cov", op: "eq", value: "yes" } },
            { type: "TrustBar", question_id: "tr", props: { items: [{ icon: "check", text: "Secure & private" }] }, conditional: { when: "cov", op: "eq", value: "yes" } },
          ] }),
        },
      },
      { key: "B", body: { section_name: "End", headline_text: "Done", content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q9", internal_field: "z" }] }) } },
    ]);
    await ctx.dispose();
  });

  test("the conditional non-producers start hidden and reveal when the condition is met", async ({ page }) => {
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });

    const tb = page.locator('[data-lg-node="tb"]');
    const tr = page.locator('[data-lg-node="tr"]');
    // The SSR emitted the hooks (PC-A13); the engine hid them on hydration
    // because the condition (cov=yes) is unmet with no answer yet.
    await expect(tb).toHaveCount(1);
    await expect(tb).toBeHidden();
    await expect(tr).toBeHidden();

    // Meet the condition → both reveal live (applyComponentVisibility toggles the hook).
    await page.locator('[data-lg-index="0"] [data-lg-choice="yes"]').first().click();
    await expect(tb).toBeVisible({ timeout: 3_000 });
    await expect(tr).toBeVisible();

    // Un-meet it → both hide again.
    await page.locator('[data-lg-index="0"] [data-lg-choice="no"]').first().click();
    await expect(tb).toBeHidden({ timeout: 3_000 });
    await expect(tr).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/conditional-hidden.png`, fullPage: true });
  });
});
