// LeadGen Round-4 Remediation — Phase P3 slice P3b probe spec (temporary;
// final consolidation lands in P7). Drives the REAL admin Quote-Builder
// structure panel (ui-quotes.ts) end to end with real fill/click (ZERO
// dispatchEvent): pages become first-class rows holding nested section slots.
//
// The flow (each op the P3b spec mandates):
//   * add 2 pages + rename them;
//   * add 2 sections to page 1 and 1 to page 2 (the per-page filtered picker);
//   * MOVE a section across pages (the explicit ◀/▶ control);
//   * reorder pages (the ↑ button);
//   * configure a page's slot as A/B 50/50 between two sections;
//   * SAVE (the P3a `pages` replace-set on putVariantHandler) → RELOAD → the
//     WHOLE structure round-trips (page names, order, slot membership + the
//     A/B split) straight off the server-rendered panel;
//   * at the 260px rail a long section name ELLIPSIZES (scrollWidth >
//     clientWidth) and its name cell does NOT intersect the controls rail;
//   * the auction marker sits AFTER the last page ("…after the last page").
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture admin-UI spec is picked up by chromium alone, like
// __p3a-pages / __p1b-render). Admin UI on 127.0.0.1 — no tenant host, no
// --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PW_PORT } from "./utils/base-url";

test.use({ viewport: { width: 1280, height: 900 } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p3b";

const NAME_S1 = "Welcome Intro Section";
const NAME_S2 = "Benefits Choice Section";
const NAME_LONG = "A very long section headline that has to ellipsize inside the two hundred and sixty pixel structure rail without ever wrapping the row";
const NAME_S4 = "Final Offer Section";
const VERTICAL = "life";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Seeded {
  quotePublicId: string;
  variantId: string;
  s1: string;
  s2: string;
  sLong: string;
  s4: string;
}

// Seed a quote with a control variant that has NO sections yet (the panel opens
// empty; the spec authors the whole page/slot tree through the UI) + four
// active sections the pickers can order.
async function seedP3bQuote(request: APIRequestContext, tag: string): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3b ${tag} ${uniq}`, activity: "quote_funnel", verticals: [VERTICAL] } }),
    "quote create",
  );
  const mk = async (name: string): Promise<string> => {
    const created = await json<{ public_id: string }>(
      await request.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel",
          vertical: VERTICAL,
          status: "active",
          section_name: name,
          headline_text: name,
          content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q", question_key: "k", internal_field: `f_${uniq}_${name.length}`, answer_type: "boolean", required: true }] }),
        },
      }),
      `section create (${name})`,
    );
    return created.public_id;
  };
  return {
    quotePublicId: quote.public_id,
    variantId: quote.funnels[0]!.variants[0]!.public_id,
    s1: await mk(NAME_S1),
    s2: await mk(NAME_S2),
    sLong: await mk(NAME_LONG),
    s4: await mk(NAME_S4),
  };
}

const label = (name: string): string => `${name} (${VERTICAL})`;

async function addSectionToPage(pageLoc: Locator, name: string): Promise<void> {
  await pageLoc.locator("[data-add-slot-select]").selectOption({ label: label(name) });
  await pageLoc.locator("[data-add-slot]").click();
}

function boxesIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("P3b — pages-first Quote-Builder structure panel", () => {
  let seed: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedP3bQuote(ctx, "core");
    await ctx.dispose();
  });

  test("author pages + slots + an A/B slot → save → reload round-trips; CSS + auction marker hold at 260px", async ({ page }) => {
    test.setTimeout(120_000);
    page.on("dialog", (d) => d.accept());

    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    const list = page.locator("#lg-section-list");
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    // a fresh variant has no pages → the empty state, no auction marker
    await expect(list.locator("[data-empty-sections]")).toBeVisible();
    await expect(list.locator('[data-auction-entry="1"]')).toHaveCount(0);

    // --- add 2 pages + rename them ------------------------------------------
    await page.locator("#lg-add-page").click();
    await page.locator("#lg-add-page").click();
    let pages = list.locator("[data-page]");
    await expect(pages).toHaveCount(2);
    await pages.nth(0).locator("[data-page-name]").fill("Welcome");
    await pages.nth(1).locator("[data-page-name]").fill("Details");

    // --- add 2 sections to page 1, 1 to page 2 ------------------------------
    await addSectionToPage(pages.nth(0), NAME_S1);
    await addSectionToPage(pages.nth(0), NAME_S2);
    await addSectionToPage(pages.nth(1), NAME_LONG);
    await expect(pages.nth(0).locator("[data-slot]")).toHaveCount(2);
    await expect(pages.nth(1).locator("[data-slot]")).toHaveCount(1);

    // --- MOVE a section across pages: s1 from page 1 → page 2 (explicit ▶) ---
    await pages.nth(0).locator("[data-slot]").first().locator("[data-slot-move-next]").click();
    await expect(pages.nth(0).locator("[data-slot]")).toHaveCount(1); // Welcome: S2
    await expect(pages.nth(1).locator("[data-slot]")).toHaveCount(2); // Details: LONG, S1

    // --- reorder pages (↑): move Details up → [Details, Welcome] ------------
    await pages.nth(1).locator("[data-page-up]").click();
    pages = list.locator("[data-page]");
    await expect(pages.nth(0).locator("[data-page-name]")).toHaveValue("Details");
    await expect(pages.nth(1).locator("[data-page-name]")).toHaveValue("Welcome");

    // --- configure page 2 (Welcome)'s slot as A/B 50/50 between two sections -
    const welcome = pages.nth(1);
    await welcome.locator("[data-slot]").first().locator("[data-slot-kind-select]").selectOption("ab");
    const abSlot = welcome.locator('[data-slot][data-slot-kind="ab"]');
    await expect(abSlot).toHaveCount(1);
    const cands = abSlot.locator("[data-ab-cand]");
    await cands.nth(0).locator("[data-ab-section]").selectOption(seed.s2); // seeded from the fixed slot, set explicitly for determinism
    await cands.nth(1).locator("[data-ab-section]").selectOption(seed.s4);
    await cands.nth(0).locator("[data-ab-pct]").fill("50");
    await cands.nth(1).locator("[data-ab-pct]").fill("50");
    await page.screenshot({ path: `${SHOT_DIR}/p3b-authored.png`, fullPage: true });

    // --- SAVE (the pages replace-set) ---------------------------------------
    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `variant PUT: ${await put.text()}`).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved", { timeout: 20_000 });

    // the save carried `pages` (NOT the legacy `sections`), mutually exclusive
    const putBody = put.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(putBody)).toContain("pages");
    expect(Object.keys(putBody)).not.toContain("sections");

    // --- RELOAD → the whole structure round-trips off the SSR panel ---------
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    const list2 = page.locator("#lg-section-list");
    const pages2 = list2.locator("[data-page]");
    await expect(pages2).toHaveCount(2);

    // order + names
    await expect(pages2.nth(0).locator("[data-page-name]")).toHaveValue("Details");
    await expect(pages2.nth(1).locator("[data-page-name]")).toHaveValue("Welcome");

    // Details: two fixed slots — LONG then S1 (membership + order)
    const detailsSlots = pages2.nth(0).locator("[data-slot]");
    await expect(detailsSlots).toHaveCount(2);
    await expect(detailsSlots.nth(0)).toHaveAttribute("data-slot-kind", "fixed");
    await expect(detailsSlots.nth(0).locator("[data-section-name]")).toHaveText(NAME_LONG);
    await expect(detailsSlots.nth(1)).toHaveAttribute("data-slot-kind", "fixed");
    await expect(detailsSlots.nth(1).locator("[data-section-name]")).toHaveText(NAME_S1);

    // Welcome: one A/B slot — S2 + S4 at 50/50
    const welcomeSlots = pages2.nth(1).locator("[data-slot]");
    await expect(welcomeSlots).toHaveCount(1);
    await expect(welcomeSlots.nth(0)).toHaveAttribute("data-slot-kind", "ab");
    const cands2 = welcomeSlots.nth(0).locator("[data-ab-cand]");
    await expect(cands2).toHaveCount(2);
    await expect(cands2.nth(0).locator("[data-ab-section]")).toHaveValue(seed.s2);
    await expect(cands2.nth(1).locator("[data-ab-section]")).toHaveValue(seed.s4);
    await expect(cands2.nth(0).locator("[data-ab-pct]")).toHaveValue("50");
    await expect(cands2.nth(1).locator("[data-ab-pct]")).toHaveValue("50");

    // --- auction marker sits AFTER the last page ----------------------------
    const marker = list2.locator('[data-auction-entry="1"]');
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveText("Auction runs after the last page"); // rich (A/B) funnel → page vocabulary
    const domOrder = await list2.evaluate((el) => {
      const kids = Array.from(el.children);
      const pageIdxs = kids.map((k, i) => (k.hasAttribute("data-page") ? i : -1)).filter((i) => i >= 0);
      const markIdx = kids.findIndex((k) => k.getAttribute("data-auction-entry") === "1");
      return { lastPageIdx: pageIdxs[pageIdxs.length - 1] ?? -1, markIdx };
    });
    expect(domOrder.markIdx).toBeGreaterThan(domOrder.lastPageIdx);

    // --- CSS (10J/Image41): at the 260px rail the long name ellipsizes and its
    // name cell never overlaps the controls rail --------------------------------
    const panelBox = await page.locator(".lg-studio-left").boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width, "the structure rail measures ~260px").toBeLessThanOrEqual(280);

    const longRow = detailsSlots.nth(0).locator(".lg-section-row");
    const nameBtn = longRow.locator("[data-select-slide]");
    const rail = longRow.locator(".lg-row-rail");
    const ellipsis = await nameBtn.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(ellipsis.scrollWidth, "long name overflows its cell → ellipsized").toBeGreaterThan(ellipsis.clientWidth);

    const nameBox = await nameBtn.boundingBox();
    const railBox = await rail.boundingBox();
    expect(nameBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(boxesIntersect(nameBox!, railBox!), "name cell must not intersect the controls rail").toBe(false);
    await page.screenshot({ path: `${SHOT_DIR}/p3b-reloaded-260.png`, fullPage: true });
  });
});
