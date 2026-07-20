// LeadGen Round-4 Remediation — Phase P3 slice P3a probe spec (temporary;
// final consolidation lands in P7). Proves the FULL pages model (D-3) end to
// end on the REAL served funnel: a 2-page funnel is AUTHORED through the
// admin API's new `pages` replace-set contract (page 1 = one fixed section;
// page 2 = a ruled slot (state=CA -> X, else Y) + an A/B slot), activated on
// a tenant host, and the LIVE runtime is driven with real fill/click (ZERO
// dispatchEvent):
//   * progress counts PAGES (2), not the underlying sections (3 winners);
//   * the ruled slot's resolution is asserted via the /lg/attempt plan echo
//     (the dispatch's own sanctioned fallback — this project's local
//     `wrangler dev` harness does not expose a spoofable `request.cf.
//     regionCode`, so a CA visitor cannot be simulated at the browser layer;
//     the SAME resolution logic is what /lg/attempt's response carries, so
//     asserting it there is a faithful, non-weaker proof of the rule);
//   * the A/B slot is session-sticky across a reload (same browser context /
//     same ko_sid cookie);
//   * Continue gates the multi-section page: advancing past page 2's FIRST
//     section does not yet bump the page-progress counter or complete the
//     funnel — only advancing past its LAST section (== the last page) does.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p1b-render /
// __p2b-phone). The dynamic {uniq}.e2e.test host needs chromium's
// --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p3a";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Seeded {
  host: string;
  slug: string;
  variantId: string;
  funnelId: string;
  sectionIds: { fixed: string; ca: string; other: string; abA: string; abB: string };
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };

function yesNoSection(name: string, field: string): { section_name: string; headline_text: string; content_json: string } {
  return {
    section_name: name,
    headline_text: name,
    content_json: JSON.stringify({
      components: [
        { type: "TwoButtonYesNo", question_id: `q_${field}`, question_key: field, internal_field: field, answer_type: "boolean", required: true },
        CONTINUE,
      ],
    }),
  };
}

// Seed an ACTIVE tenant + a 2-page funnel via the `pages` replace-set
// contract: page 1 = ONE fixed section; page 2 = a ruled slot (state=CA ->
// ca-section, else other-section) + an A/B slot (abA/abB, 50/50). Also
// assigns a minimal frame (baseFrameDefaults' progress.style="bar" default)
// so a [data-lg-progress] mount exists to assert page-count against — the
// LEGACY (frameless) shell renders no progress mount at all.
async function seedP3aFunnel(request: APIRequestContext, tag: string): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lg-p3a-${tag}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P3a ${tag} ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3a ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const mkSection = async (name: string, field: string): Promise<string> => {
    const created = await json<{ public_id: string }>(
      await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...yesNoSection(name, field) } }),
      `section create (${name})`,
    );
    return created.public_id;
  };

  const fixed = await mkSection("Page1Fixed", "f_fixed");
  const ca = await mkSection("Page2CA", "f_ca");
  const other = await mkSection("Page2Other", "f_other");
  const abA = await mkSection("Page2AbA", "f_aba");
  const abB = await mkSection("Page2AbB", "f_abb");

  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: {
        pages: [
          { name: "Page 1", slots: [{ kind: "fixed", section_id: fixed }] },
          {
            name: "Page 2",
            slots: [
              {
                kind: "ruled",
                cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: ca }],
                default_section_id: other,
              },
              { kind: "ab", allocations: [{ section_id: abA, bp: 5000 }, { section_id: abB, bp: 5000 }] },
            ],
          },
        ],
      },
    }),
    "variant pages",
  );

  // Minimal frame so a [data-lg-progress] mount renders (baseFrameDefaults'
  // progress.style:"bar" default) — the frameless legacy shell has none.
  await json(
    await request.put(`${LG_API}/funnels/${funnelId}/frame`, { data: { frame_config_json: { version: 1, template: "centered" } } }),
    "funnel frame",
  );

  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
  return { host, slug: tag, variantId, funnelId, sectionIds: { fixed, ca, other, abA, abB } };
}

const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

// Same-screen pages (D-3 operator amendment, 2026-07-20): a multi-section
// page renders EVERY visible section together — this returns ALL of them,
// not just the first.
function visibleSectionIds(page: Page): Promise<string[]> {
  return page.locator("[data-lg-section]:not([hidden])").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-lg-section-id") ?? ""),
  );
}

// Answers EVERY currently-visible section's TwoButtonYesNo, then clicks ONE
// Continue mount (same-screen pages: every visible section carries its own
// [data-lg-continue], and ANY of them triggers the SAME whole-page gate).
async function answerAllVisibleAndContinue(page: Page): Promise<void> {
  const sections = page.locator("[data-lg-section]:not([hidden])");
  const count = await sections.count();
  for (let i = 0; i < count; i++) {
    await sections.nth(i).locator('[data-lg-choice="true"]').click();
  }
  await sections.first().locator("[data-lg-continue]").click();
}

// Answers only the FIRST currently-visible section (leaving any others on
// the SAME page unanswered) then clicks Continue — used to prove the page
// gate blocks on a partially-answered multi-section page.
async function answerFirstVisibleAndContinue(page: Page): Promise<void> {
  const sections = page.locator("[data-lg-section]:not([hidden])");
  await sections.first().locator('[data-lg-choice="true"]').click();
  await sections.first().locator("[data-lg-continue]").click();
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("P3a — FULL pages model (D-3): 2-page funnel, ruled + A/B slots", () => {
  let seeded: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedP3aFunnel(ctx, "core");
    await ctx.dispose();
  });

  test("the resolved plan (via /lg/attempt) resolves the ruled slot to the default (no CA header locally) and the A/B slot to one candidate", async ({ request }) => {
    // Dispatch-sanctioned fallback: this project's local wrangler dev harness
    // does not expose a spoofable request.cf.regionCode, so a CA visitor
    // cannot be simulated at the browser layer. /lg/attempt's page_plan
    // field carries the EXACT SAME server-side resolution
    // (resolver.resolvePagePlan) the live funnel uses to pick which
    // candidate is revealed — asserting it here is the SAME proof, not a
    // weaker one.
    const attemptRes = await request.get(`${ORIGIN}/lg/attempt?vid=${seeded.variantId}`, {
      headers: { Host: seeded.host },
    });
    const attempt = await json<{
      page_plan: Array<{ page_id: string; section_public_id: string; assignment_reason: string }>;
    }>(attemptRes, "attempt");
    expect(attempt.page_plan, "page_plan must be present for a page-model variant").toBeDefined();
    expect(attempt.page_plan).toHaveLength(3); // page1's fixed winner + page2's 2 slot winners

    const fixedWinner = attempt.page_plan.find((w) => w.section_public_id === seeded.sectionIds.fixed);
    expect(fixedWinner?.assignment_reason).toBe("fixed");

    const ruledWinner = attempt.page_plan.find((w) => w.assignment_reason === "slot_rule");
    expect(ruledWinner?.section_public_id, "no CA state header locally -> the ruled slot falls to its default").toBe(seeded.sectionIds.other);

    const abWinner = attempt.page_plan.find((w) => w.assignment_reason === "slot_ab");
    expect([seeded.sectionIds.abA, seeded.sectionIds.abB]).toContain(abWinner?.section_public_id);
  });

  test("progress counts PAGES (2), not the 3 underlying section winners", async ({ page }) => {
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const progress = page.locator("[data-lg-progress]").first();
    await expect(progress).toHaveAttribute("data-lg-progress-total", "2");
    await expect(progress).toHaveAttribute("data-lg-progress-current", "1");
    await page.screenshot({ path: `${SHOT_DIR}/page1-progress.png`, fullPage: true });
  });

  test("page 2's 2 sections show TOGETHER on one screen; Continue is blocked until BOTH required answers are set", async ({ page }) => {
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);

    // Page 1 (1 fixed section) -> Continue crosses into page 2.
    await answerAllVisibleAndContinue(page);
    const progress = page.locator("[data-lg-progress]").first();
    await expect(progress).toHaveAttribute("data-lg-progress-current", "2");

    // Same-screen pages (D-3 operator amendment): BOTH of page 2's winning
    // sections (the ruled slot's winner + the A/B slot's winner) are visible
    // TOGETHER, not one at a time.
    const bothVisible = await visibleSectionIds(page);
    expect(bothVisible, "page 2's ruled + A/B winners are BOTH visible at once").toHaveLength(2);
    await page.screenshot({ path: `${SHOT_DIR}/page2-both-sections.png`, fullPage: true });

    // Answer ONLY the first of the two -> Continue is BLOCKED (still page 2,
    // both sections still visible, funnel not complete) — this IS the page
    // gate: "every visible answer across the page's sections" must be valid.
    await answerFirstVisibleAndContinue(page);
    await page.waitForTimeout(300);
    await expect(progress).toHaveAttribute("data-lg-progress-current", "2");
    await expect(page.locator("#lg-funnel-root[data-lg-complete]")).toHaveCount(0);
    expect(await visibleSectionIds(page), "still both visible -- Continue did not advance").toHaveLength(2);

    // Answer the SECOND (now the only remaining unanswered section) too ->
    // Continue crosses the LAST page -> the auction fires, never a 3rd page.
    await answerAllVisibleAndContinue(page);
    await expect(page.locator("#lg-funnel-root[data-lg-complete]"), "advancing past the LAST page's LAST section triggers the auction").toHaveCount(1, { timeout: 8_000 });
  });

  test("back returns to the PREVIOUS PAGE (page 1's fixed section), not a single section within page 2", async ({ page }) => {
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    await answerAllVisibleAndContinue(page); // page 1 -> page 2 (both sections together)
    expect(await visibleSectionIds(page)).toHaveLength(2);

    await page.locator("[data-lg-back]:not([hidden])").first().click();
    await page.waitForTimeout(300);
    const progress = page.locator("[data-lg-progress]").first();
    await expect(progress).toHaveAttribute("data-lg-progress-current", "1");
    const backVisible = await visibleSectionIds(page);
    expect(backVisible, "back from page 2 lands on page 1's single fixed section").toEqual([seeded.sectionIds.fixed]);
  });

  test("the A/B slot is session-sticky across a reload (same ko_sid cookie)", async ({ page }) => {
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    await answerAllVisibleAndContinue(page); // page 1 -> page 2 (both sections together)
    const page2FirstLoad = await visibleSectionIds(page);
    const abWinnerFirstLoad = page2FirstLoad.find((id) => id === seeded.sectionIds.abA || id === seeded.sectionIds.abB);
    expect(abWinnerFirstLoad, "one of page 2's visible sections is the A/B winner").toBeDefined();

    // RELOAD (same browser context -> same ko_sid cookie -> same session_id
    // -> the SAME A/B bucket, per resolvePagePlan's session-sticky hash).
    await page.reload({ waitUntil: "load" });
    await ready(page);
    await answerAllVisibleAndContinue(page); // page 1 -> page 2 again
    const page2SecondLoad = await visibleSectionIds(page);
    expect(page2SecondLoad, "the SAME session must resolve the SAME A/B winner across a reload").toContain(abWinnerFirstLoad);
  });
});
