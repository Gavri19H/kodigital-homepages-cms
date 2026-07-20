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
// Review-round addition (P3 minor-4): the two sections the RULED-slot test
// wires — a case-branch candidate ("X") and the required default ("Y").
const NAME_RULED_CASE = "California Rate Section";
const NAME_RULED_DEFAULT = "Standard Rate Section";
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
      // Indexed `.item()` walk, not `Array.from(el.children)` — the project
      // tsconfig's `lib` is `["ES2022"]` (no `dom.iterable`), so an
      // HTMLCollection isn't recognized as `Iterable<Element>` and
      // `Array.from` would infer `unknown[]` (TS18046 on every element use).
      const kids: Element[] = [];
      for (let i = 0; i < el.children.length; i++) {
        const kid = el.children.item(i);
        if (kid) kids.push(kid);
      }
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

interface RuledSeed {
  quotePublicId: string;
  variantId: string;
  caseSectionName: string;
  caseSectionId: string;
  defaultSectionName: string;
  defaultSectionId: string;
}

// A SEPARATE quote/variant + 2 dedicated sections for the ruled-slot test,
// deliberately NOT reusing seedP3bQuote: the admin editor's add-picker list
// (`/api/admin/leadgen/sections?activity=...`) is GLOBAL to the activity, not
// scoped to one quote, and addSectionToPage matches an option by its VISIBLE
// LABEL (the picker's numeric `value` isn't known ahead of a section's
// creation). Calling seedP3bQuote a second time would re-mint its FOUR fixed
// literal names (NAME_S1..NAME_S4) verbatim, producing duplicate labels in
// that shared list and making the A/B test's OWN label-based picks
// nondeterministic. This fixture's two names instead embed a fresh `uniq`
// suffix, so they can never collide with NAME_S1..NAME_S4/NAME_LONG or with
// themselves across repeated runs.
async function seedRuledFixture(request: APIRequestContext): Promise<RuledSeed> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3b ruled ${uniq}`, activity: "quote_funnel", verticals: [VERTICAL] } }),
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
  const caseSectionName = `${NAME_RULED_CASE} ${uniq}`;
  const defaultSectionName = `${NAME_RULED_DEFAULT} ${uniq}`;
  return {
    quotePublicId: quote.public_id,
    variantId: quote.funnels[0]!.variants[0]!.public_id,
    caseSectionName,
    caseSectionId: await mk(caseSectionName),
    defaultSectionName,
    defaultSectionId: await mk(defaultSectionName),
  };
}

// ---------------------------------------------------------------------------
// Review-round addition (P3 minor-4): the ruled-slot editor round-trips
// through REAL picker clicks — the A/B leg above already proves the kind-
// switch + save/reload machinery; this proves the SAME machinery for `kind:
// "ruled"` (cases[] + a REQUIRED default), which until now was only exercised
// server-side (quotes-handlers.ts preparePages / the P3a Playwright spec's
// pre-authored fixture). Its OWN isolated quote (seedRuledFixture) —
// independent of the A/B test's DOM/save state above.
// ---------------------------------------------------------------------------
test.describe("P3b — ruled-slot editor (review round, P3 minor-4)", () => {
  let seed: RuledSeed;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedRuledFixture(ctx);
    await ctx.dispose();
  });

  test("configure a page's slot as RULED (state is CA → section X, default section Y) via the pickers → save → reload round-trips", async ({ page }) => {
    test.setTimeout(120_000);
    page.on("dialog", (d) => d.accept());

    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    const list = page.locator("#lg-section-list");

    // --- one page, one starting (fixed) slot on section Y --------------------
    await page.locator("#lg-add-page").click();
    const pages = list.locator("[data-page]");
    await expect(pages).toHaveCount(1);
    const p1 = pages.nth(0);
    await addSectionToPage(p1, seed.defaultSectionName); // Y — becomes the fixed slot the kind-switch seeds `default_section_id` from
    await expect(p1.locator("[data-slot]")).toHaveCount(1);
    await expect(p1.locator("[data-slot]").first()).toHaveAttribute("data-slot-kind", "fixed");

    // --- switch the slot's kind to Rule… via the real kind-select picker ------
    await p1.locator("[data-slot]").first().locator("[data-slot-kind-select]").selectOption("ruled");
    const ruledSlot = p1.locator('[data-slot][data-slot-kind="ruled"]');
    await expect(ruledSlot).toHaveCount(1);
    // switching from a fixed(Y) slot auto-seeds the new default to Y (a sane
    // starting point — every ruled slot must always resolve to something)
    await expect(ruledSlot.locator("[data-ruled-default]")).toHaveValue(seed.defaultSectionId);

    // --- author the case (state is CA → section X) through the pickers -------
    const caseRow = ruledSlot.locator("[data-ruled-case]").first();
    await caseRow.locator("[data-ruled-field]").selectOption("state"); // entry-known field picker
    await caseRow.locator("[data-ruled-op]").selectOption("eq"); // "is"
    await caseRow.locator("[data-ruled-value]").fill("CA");
    await caseRow.locator("[data-ruled-section]").selectOption(seed.caseSectionId); // X

    // --- the default (section Y) — re-confirm explicitly via its own picker --
    await ruledSlot.locator("[data-ruled-default]").selectOption(seed.defaultSectionId);
    await page.screenshot({ path: `${SHOT_DIR}/p3b-ruled-authored.png`, fullPage: true });

    // --- SAVE (the pages replace-set) -----------------------------------------
    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `variant PUT: ${await put.text()}`).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved", { timeout: 20_000 });

    // the accepted payload carried a genuine `ruled` slot (not a UI-only shape)
    const putBody = put.request().postDataJSON() as { pages: Array<{ slots: Array<Record<string, unknown>> }> };
    const sentSlot = putBody.pages[0]!.slots[0]!;
    expect(sentSlot["kind"]).toBe("ruled");
    expect(sentSlot["default_section_id"]).toBe(seed.defaultSectionId);
    expect(sentSlot["cases"]).toEqual([{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: seed.caseSectionId }]);

    // --- RELOAD → the ruled config round-trips off the SSR panel -------------
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    const list2 = page.locator("#lg-section-list");
    const pages2 = list2.locator("[data-page]");
    await expect(pages2).toHaveCount(1);
    const slot2 = pages2.nth(0).locator("[data-slot]");
    await expect(slot2).toHaveCount(1);
    await expect(slot2.first()).toHaveAttribute("data-slot-kind", "ruled");

    // the case row is VISIBLE with the right selections
    const caseRow2 = slot2.first().locator("[data-ruled-case]").first();
    await expect(caseRow2).toBeVisible();
    await expect(caseRow2.locator("[data-ruled-field]")).toHaveValue("state");
    await expect(caseRow2.locator("[data-ruled-op]")).toHaveValue("eq");
    await expect(caseRow2.locator("[data-ruled-value]")).toHaveValue("CA");
    await expect(caseRow2.locator("[data-ruled-section]")).toHaveValue(seed.caseSectionId);

    // …and the default is visible with the right selection
    await expect(slot2.first().locator("[data-ruled-default]")).toBeVisible();
    await expect(slot2.first().locator("[data-ruled-default]")).toHaveValue(seed.defaultSectionId);
    await page.screenshot({ path: `${SHOT_DIR}/p3b-ruled-reloaded.png`, fullPage: true });
  });
});
