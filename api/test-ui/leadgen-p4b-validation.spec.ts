// P4b LIVE validation legs (register PC-A2/PC-6/PC-A3/PC-A4/PC-5/PC-A5 + D3).
//
// The Continue gate (D3) blocks on EVERY visible invalid answer — required AND
// format — and the failure now PAINTS into the always-present auto error slot
// (PC-A2). These legs drive the REAL served funnel and prove, end to end:
//   1. invalid phone blocks Continue with a VISIBLE message (PC-A4)
//   2. a date before the RESOLVED min bound blocks with a message; a +7d token
//      authored on the section resolves to a concrete date the live page
//      enforces (PC-5/PC-A5)
//   3. an off-grid number blocks with the nearest-neighbor message (PC-A3)
//   4. a required NameFieldsGroup blocks until BOTH sub-fields are filled (PC-A2)
//   5. an EmailInputQuestion's error_text renders VISIBLY on a format failure
//      with NO ValidationError authored (PC-6 — the previously-invisible case)
//
// Seeds a real ACTIVE tenant + activated funnel through the REAL admin APIs (the
// leadgen-p4a-behavior pattern); the tenant host resolves to 127.0.0.1.
//
// CROSS-ENGINE (playwright.config.ts CROSS_ENGINE_GESTURE_SPECS, the p2a/p3a
// shape): chromium runs the whole file; firefox's testMatch picks it up too.
// The 5 legs above all drive a dynamic `{uniq}.e2e.test` host, which needs
// chromium's `--host-resolver-rules` (test.use below) — firefox cannot resolve
// it, so each test.skip()s on firefox with a documented reason. The combined
// "PC-5/PC-A5 combined" describe further down splits studio-driving (no e2e.test
// dependency — runs on BOTH engines) from the live-funnel enforcement leg
// (chromium; firefox-skip, same reason).
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { seedSharedFirstPage, createPassThroughSection } from "./leadgen-shared-page-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p4b";

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Seeded { host: string; slug: string; }

async function seedFunnel(request: APIRequestContext, tag: string, sections: Array<{ body: Record<string, unknown> }>): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lg-p4b-${tag}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P4b ${tag} ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P4b ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const attach: Array<{ section_id: number }> = [];
  for (const s of sections) {
    const created = await json<{ id: number }>(
      await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...s.body } }),
      "section create",
    );
    attach.push({ section_id: created.id });
  }
  // Rework §4.3-1: the quote's shared first page is mandatory for activation, and
  // resolver.ts composes [...sharedPages, ...variantPages] — so this fixture's FIRST
  // section becomes the shared page and the rest stay on the variant. Composed order,
  // section_index and [data-lg-index="N"] are unchanged. A single-section fixture keeps
  // the variant non-empty (the gate's second half) with a trailing pass-through page.
  const [firstAttach, ...restAttach] = attach;
  const variantSections =
    restAttach.length > 0 ? restAttach : [{ section_id: await createPassThroughSection(request, `P4b ${tag}`) }];
  await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: variantSections } }), "variant sections");
  await seedSharedFirstPage(request, quote.public_id, [firstAttach!.section_id]);
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
  return { host, slug: tag };
}

const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;
const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
const NEXT = { body: { section_name: "Next", headline_text: "Step 2", content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qn9", internal_field: "z9" }] }) } };

// section_index off the live engine.
function sectionIndex(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index);
}
async function ready(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

test.beforeAll(() => { mkdirSync(SHOT_DIR, { recursive: true }); });

test.describe("PC-A4 — invalid phone blocks Continue with a visible message", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "phone", [
      { body: { section_name: "Phone", headline_text: "Your phone", content_json: JSON.stringify({ components: [
        { type: "PhoneInputQuestion", question_id: "q1", internal_field: "phone", required: true }, CONTINUE,
      ] }) } },
      NEXT,
    ]);
    await ctx.dispose();
  });

  test("a NANP-invalid number blocks + paints the auto slot; a valid one advances", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the PC-5/PC-A5 combined describe below has the both-engine studio-only leg",
    );
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    expect(await sectionIndex(page)).toBe(0);

    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill("1111111111");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "invalid phone must block Continue").toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="phone"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText("valid US phone");
    await page.screenshot({ path: `${SHOT_DIR}/phone-invalid.png`, fullPage: true });

    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill("(415) 555-1234");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
  });
});

test.describe("PC-6 — email error_text renders VISIBLY with NO ValidationError authored", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "email", [
      { body: { section_name: "Email", headline_text: "Your email", content_json: JSON.stringify({ components: [
        { type: "EmailInputQuestion", question_id: "q1", internal_field: "email", required: true, props: { error_text: "If it is wrong, say so." } }, CONTINUE,
      ] }) } },
      NEXT,
    ]);
    await ctx.dispose();
  });

  test("the authored error_text is the visible message on a format failure", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the PC-5/PC-A5 combined describe below has the both-engine studio-only leg",
    );
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill("not-an-email");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page)).toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="email"]');
    await expect(slot).toBeVisible();
    await expect(slot).toHaveText("If it is wrong, say so.");
    await page.screenshot({ path: `${SHOT_DIR}/email-errortext.png`, fullPage: true });
  });
});

test.describe("PC-A3 — off-grid number blocks with the nearest-neighbor message", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "step", [
      { body: { section_name: "Amount", headline_text: "How many?", content_json: JSON.stringify({ components: [
        { type: "NumberInputQuestion", question_id: "q1", internal_field: "n", required: true, props: { min: 1, step: 5 } }, CONTINUE,
      ] }) } },
      NEXT,
    ]);
    await ctx.dispose();
  });

  test("502 (off-grid for min=1 step=5) names 501 and 506", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the PC-5/PC-A5 combined describe below has the both-engine studio-only leg",
    );
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill("502");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page)).toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="n"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText("501 and 506");
  });
});

test.describe("PC-5/PC-A5 — a +7d date bound resolves and the live page enforces the concrete date", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "date", [
      { body: { section_name: "Date", headline_text: "Pick a date", content_json: JSON.stringify({ components: [
        // authored with the +7d TOKEN — resolved server-side to a concrete ISO
        { type: "DateQuestion", question_id: "q1", internal_field: "d", required: true, props: { min: "+7d" } }, CONTINUE,
      ] }) } },
      NEXT,
    ]);
    await ctx.dispose();
  });

  test("today (before today+7) blocks with the resolved concrete date in the message", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the PC-5/PC-A5 combined describe below has the both-engine studio-only leg",
    );
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const min = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7));
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill(iso(today));
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page)).toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="d"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText(iso(min)); // the CONCRETE resolved date, not "+7d"
    // a date on/after the resolved min advances
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill(iso(new Date(min.getTime() + 86_400_000)));
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PC-5/PC-A5 combined — the REAL studio Min token dropdown -> live enforce
// ---------------------------------------------------------------------------
// Conductor closure: the describe above proves live enforcement from an
// API-authored `props.min: "+7d"`. This closes the OTHER half of the loop — did
// a HUMAN using the real studio picker ever actually reach that state? Two
// tests, split the same way p2a/p3a split their studio-canvas vs. live-/lg
// legs:
//   (a) drives the REAL studio validation tab (a real click selects the
//       DateQuestion node, a real click opens the Content tab, a real
//       selectOption() picks "In 7 days" from the Min token dropdown, a real
//       click on the Save button persists it) and proves the TOKEN — not a
//       pre-resolved date — is what's stored (resolution happens at config
//       build, never at save time). This test has NO e2e.test host dependency
//       (a plain /admin/leadgen/sections/{id}/edit page) and runs on BOTH
//       engines — the literal "both engines where the studio leg allows" ask.
//   (b) reuses THAT EXACT section (module-scoped id/public_id set by (a) —
//       workers:1 + fullyParallel:false makes the ordering safe) — attaches it
//       to a fresh funnel/variant, activates it, and opens the LIVE funnel:
//       below the resolved bound blocks with the concrete date in the message;
//       on the resolved bound it passes. Needs the dynamic e2e.test host, so
//       it test.skip()s on firefox exactly like every other live leg above.
test.describe("PC-5/PC-A5 combined — studio Min token picker -> live enforce", () => {
  let studioSection: { id: number; public_id: string } | undefined;

  test("the real studio Min token dropdown (+7 days) persists the TOKEN onto the DateQuestion node (both engines)", async ({ page }) => {
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const created = await json<{ id: number; public_id: string }>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: `Date studio ${uniq}`,
          activity: "quote_funnel",
          vertical: "life",
          status: "active",
          headline_text: "Pick a date",
          content_json: { components: [{ type: "DateQuestion", question_id: "q_date", internal_field: "d", required: true }, CONTINUE] },
        },
      }),
      "date-studio section create",
    );
    studioSection = created;

    await page.goto(`/admin/leadgen/sections/${created.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const canvasFrame = page.frameLocator("#lg-studio-canvas-frame");
    await expect(canvasFrame.locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });

    // real click: select the DateQuestion node on the canvas.
    await canvasFrame.locator('[data-component-type="DateQuestion"]').click({ timeout: 8_000 });
    // real click: the Content tab (where the Validation Min/Max controls live).
    await page.locator('[data-studio-inspector-tab="content"]').click({ timeout: 4_000 });
    await page.waitForTimeout(200);

    const minSelect = page.locator('[data-inspector-vdate="min"]');
    await expect(minSelect, "the Min token dropdown is present + visible for a Date field").toBeVisible({ timeout: 4_000 });
    const minInput = page.locator('[data-inspector-vprop="min"]');
    await expect(minInput, "the native date input is hidden while in token mode").toBeHidden();

    // real selectOption: pick "In 7 days" (value "+7d") from the token dropdown.
    await minSelect.selectOption("+7d", { timeout: 4_000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOT_DIR}/date-studio-min-token.png`, fullPage: true });

    // real click: Save (a full page reload, the studio's own save mechanism —
    // the same #lg-section-save + waitForEvent("load") pairing forensic-live-
    // probe.spec.ts's P8/P9 use).
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click({ timeout: 5_000 })]);

    const detail = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(
      await page.request.get(`${LG_API}/sections/${created.public_id}`),
      "date-studio detail refetch",
    );
    const persistedMin = detail.content_json.components.find((c) => c.question_id === "q_date")?.props?.["min"] ?? null;
    // the TOKEN persists verbatim — resolution is config-dto's job at config
    // build, never the studio's save path.
    expect(persistedMin, "the +7d TOKEN (not a pre-resolved date) persists on save").toBe("+7d");
  });

  test("the live funnel enforces the resolved concrete date for the studio-authored +7d bound", async ({ page, request, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the studio Min-token-picker test above (this same describe) runs on BOTH engines",
    );
    if (studioSection === undefined) {
      throw new Error("studioSection was not set — the studio Min-token-picker test above must run first in this file (workers:1, declaration order)");
    }
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const host = `lg-p4b-date-studio-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P4b date-studio ${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P4b date-studio ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    // A SECOND section is required: with only one section in the variant,
    // Continue on the last section triggers funnel COMPLETION (the
    // auction/banners view), not a section_index bump — there is nowhere to
    // "advance" to, so the sectionIndex-must-become-1 assertion below would
    // never resolve regardless of validation outcome. Reuses the same NEXT
    // body every other describe in this file attaches after its own section.
    const nextCreated = await json<{ id: number }>(
      await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...NEXT.body } }),
      "date-studio NEXT section create",
    );
    // Rework §4.3-1 (same move as seedFunnel above): the studio-authored section IS
    // page 1, so it lives on the quote's mandatory shared first page and the variant
    // keeps NEXT. resolver.ts composes [...sharedPages, ...variantPages], so the
    // studio section is still index 0 and Continue still bumps to index 1.
    await json(
      await request.put(`${LG_API}/variants/${variantId}`, {
        data: { sections: [{ section_id: nextCreated.id }] },
      }),
      "variant sections",
    );
    await seedSharedFirstPage(request, quote.public_id, [studioSection.id]);
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "datestudio" } }), "activation");

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const min = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7));

    await page.goto(`http://${host}:${PW_PORT}/lg/datestudio`, { waitUntil: "load" });
    await ready(page);
    expect(await sectionIndex(page)).toBe(0);

    // below the resolved bound (today) -> blocked, message names the CONCRETE
    // resolved date (never the "+7d" token).
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill(iso(today));
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "a date before the resolved min must block").toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="d"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText(iso(min));
    await expect(slot).not.toContainText("+7d");

    // exactly on the resolved bound -> passes (inclusive).
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill(iso(min));
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
    await page.screenshot({ path: `${SHOT_DIR}/date-studio-live-enforced.png`, fullPage: true });
  });
});

test.describe("PC-A2 — a required NameFieldsGroup blocks until both sub-fields are filled", () => {
  let seeded: Seeded;
  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seeded = await seedFunnel(ctx, "name", [
      { body: { section_name: "Name", headline_text: "Your name", content_json: JSON.stringify({ components: [
        { type: "NameFieldsGroup", question_id: "qn", required: true }, CONTINUE,
      ] }) } },
      NEXT,
    ]);
    await ctx.dispose();
  });

  test("empty/partial name blocks; both filled advances (the previously-uncaught case)", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the PC-5/PC-A5 combined describe below has the both-engine studio-only leg",
    );
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    // empty → blocked, group slot visible
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "empty required name must block").toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="qn"]');
    await expect(slot).toBeVisible();
    // partial (first only) → still blocked
    await page.locator('[data-lg-index="0"] [data-name-field="first"]').fill("Ada");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "partial name must still block").toBe(0);
    // both → advances
    await page.locator('[data-lg-index="0"] [data-name-field="last"]').fill("Lovelace");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
    await page.screenshot({ path: `${SHOT_DIR}/name-required.png`, fullPage: true });
  });
});
