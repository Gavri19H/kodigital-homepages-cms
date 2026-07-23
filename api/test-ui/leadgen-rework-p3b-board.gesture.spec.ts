// LEADGEN-REWORK-03 P3b (S3b.1) — Funnel-builder BOARD real-journey gestures
// (§8.2). Drives the in-house mouse drag engine (no native HTML5 DnD — so
// page.mouse streams deliver on BOTH engines; the board is main-document, not a
// srcdoc canvas, so no --host-resolver / iframe caveats) + the menu (a11y)
// equivalents, against a live wrangler-dev worker. Persistence is API+reload:
// every mutation round-trips a landed P1 endpoint and the assertion is made
// after the reload (Playwright auto-waits through it). A-4 (uniqueness on drop)
// and A-5 (funnel delete guard) are rendered from the server response and
// asserted VERBATIM.
//
// Run (per-file, worktree-isolated, fresh D1; PW_PORT=8899 per this worktree):
//   cd api && npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-rework-p3b-board.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
// BOTH ENGINES: engine-agnostic (main-document pointer streams); firefox runs
// once this file is added to playwright.config.ts's CROSS_ENGINE_GESTURE_SPECS
// (that config is outside this slice's file ownership — flagged in the report).

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page, type Locator } from "@playwright/test";
import { PW_PORT } from "./utils/base-url";

// Interaction tests use a WIDE viewport so the board's columns fit without
// internal h-scroll (admin nav ~270 + rail-left 292 + rail-right 344 leave a
// narrow center at 1280 — the board h-scroll is by design; the render test
// below sets 1280 & 375 explicitly for the pinned screenshots + no-body-scroll
// assertion). Real geometry proof at the pinned widths lives in that test.
test.use({ viewport: { width: 1920, height: 1000 } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// P2-B fix (adversarial review): a unique per-invocation name — the SAME
// Date.now()+rand pattern seedQuote already uses below — so the default
// BOTH-project Playwright invocation (chromium then firefox, ONE process, ONE
// persisted wrangler-dev D1, no inter-project reset) never leaves two
// identically-named sections sitting in the activity's GLOBAL library/popover
// pickers. Callers that query those GLOBAL surfaces (the section-library
// popover, unlike a quote's own funnel/shared column which is naturally
// scoped to sections actually attached to IT) must locate by the returned
// exact `name`, not the bare base label passed in — a substring `hasText`
// match on the base label alone would still resolve multiple elements once a
// same-labeled leftover from a prior/other-project run persists.
async function createSection(request: APIRequestContext, name: string): Promise<{ id: number; public_id: string; name: string }> {
  const uniqueName = `${name} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const section = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        activity: "quote_funnel", vertical: "car", status: "active", section_name: uniqueName, headline_text: uniqueName,
        content_json: JSON.stringify({ components: [
          { type: "TwoButtonYesNo", question_id: "q", question_key: "f", internal_field: "f", answer_type: "boolean", required: true },
          { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
        ] }),
      },
    }),
    `section (${uniqueName})`,
  );
  return { ...section, name: uniqueName };
}

interface Quote { public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>; }
async function seedQuote(request: APIRequestContext): Promise<Quote> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return json(await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3b Board ${u}`, activity: "quote_funnel", verticals: ["car"] } }), "quote");
}

async function openEditor(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-board]")).toBeVisible({ timeout: 20_000 });
}

// In-house mouse drag: press on source, cross the 5px threshold, glide to the
// target center, release. Mirrors the studio's held-button page.mouse stream.
async function dragCenterToCenter(page: Page, source: Locator, target: Locator): Promise<void> {
  // The board is the only h-scroller (rail-left 292 + narrow center + rail-right
  // 344 under the admin nav) — a funnel column can sit past the center's right
  // edge. Scroll BOTH endpoints into the board's visible area before measuring,
  // so the pointer stream lands on real, unclipped pixels.
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("drag: missing bounding box");
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 8, s.y + s.height / 2 + 8, { steps: 4 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2 + 2, { steps: 2 });
  await page.mouse.up();
}

let apiCtx: APIRequestContext;
test.beforeAll(async () => { apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN }); });
test.afterAll(async () => { await apiCtx.dispose(); });

test.describe("P3b Funnel-builder board — live journeys (§8.2)", () => {
  test("board renders library / board / rules-mount + responsive screenshots (1280 & 375)", async ({ page }) => {
    const s = await createSection(apiCtx, "Credit Score");
    const quote = await seedQuote(apiCtx);
    // one page with the section, so a chip + page card render
    await json(await apiCtx.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: s.public_id }] }] },
    }), "seed page");
    await openEditor(page, quote.public_id);
    // pinned desktop width for the screenshot + no-body-scroll proof (MUST-PIN 1)
    await page.setViewportSize({ width: 1280, height: 900 });

    await expect(page.locator(".lg-board-left")).toBeVisible();
    await expect(page.locator(".lg-col-shared")).toBeVisible();
    await expect(page.locator(".lg-col-funnel")).toHaveCount(1);
    await expect(page.locator("[data-add-funnel]")).toBeVisible();
    await expect(page.locator("[data-rules-rail]")).toBeVisible();

    // MUST-PIN 1: the board is the ONLY horizontal scroller — the page body
    // never scrolls sideways.
    const bodyScrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(bodyScrolls, "page body must not scroll horizontally").toBe(false);

    await page.screenshot({ path: "test-results/p3b-board-1280.png", fullPage: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator("[data-board]")).toBeVisible();
    const bodyScrolls375 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(bodyScrolls375, "page body must not scroll horizontally at 375").toBe(false);
    await page.screenshot({ path: "test-results/p3b-board-375.png", fullPage: false });
  });

  test("library -> funnel page: drag adds a section chip (persists across reload)", async ({ page }) => {
    const seed = await createSection(apiCtx, "Seed Section");
    const extra = await createSection(apiCtx, "Vehicle Year");
    const quote = await seedQuote(apiCtx);
    await json(await apiCtx.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: seed.public_id }] }] },
    }), "seed page");
    await openEditor(page, quote.public_id);

    const pageCard = page.locator(".lg-col-funnel [data-page-card]").first();
    const libCard = page.locator(`[data-lib-card][data-section-public-id="${extra.public_id}"]`);
    await expect(libCard).toBeVisible();
    // exact generated name (not the bare "Vehicle Year" label) — safe even if
    // a same-labeled leftover section persists from an earlier project's run.
    await expect(pageCard.locator(".lg-sc-name", { hasText: extra.name })).toHaveCount(0);

    await dragCenterToCenter(page, libCard, pageCard);
    // island PUT /variants/:id -> reload; the chip is present after reload
    await expect(page.locator(".lg-col-funnel [data-sec-chip] .lg-sc-name", { hasText: extra.name })).toBeVisible({ timeout: 20_000 });
  });

  test("＋ section menu path (a11y equivalent) adds a chip to the shared page", async ({ page }) => {
    const s = await createSection(apiCtx, "ZIP Code");
    const quote = await seedQuote(apiCtx);
    await openEditor(page, quote.public_id);

    await page.locator("[data-add-shared-section]").click();
    const picker = page.locator("[data-template-menu]");
    await expect(picker).toBeVisible();
    // exact generated name: this popover lists the GLOBAL activity/vertical
    // section library (not scoped to this quote) — a bare "ZIP Code" substring
    // match would resolve multiple elements once a same-labeled leftover
    // section from an earlier/other-project run persists (the strict-mode
    // violation this fix closes).
    await picker.locator(".lg-menu-item", { hasText: s.name }).click();
    await expect(page.locator('.lg-col-shared [data-sec-chip] .lg-sc-name', { hasText: s.name })).toBeVisible({ timeout: 20_000 });
  });

  test("+ Add funnel creates a new column", async ({ page }) => {
    const quote = await seedQuote(apiCtx);
    await openEditor(page, quote.public_id);
    await expect(page.locator(".lg-col-funnel")).toHaveCount(1);
    await page.locator("[data-add-funnel]").click();
    await expect(page.locator(".lg-col-funnel")).toHaveCount(2, { timeout: 20_000 });
  });

  test("funnel kebab -> Set as default moves the Default chip; deleting the default is guarded (A-5 verbatim)", async ({ page }) => {
    const quote = await seedQuote(apiCtx);
    // second funnel so the first isn't the last; keep the auto funnel as default target
    await json(await apiCtx.post(`${LG_API}/quotes/${quote.public_id}/funnels`, { data: { funnel_name: "Second funnel" } }), "funnel 2");
    await openEditor(page, quote.public_id);

    const firstCol = page.locator(".lg-col-funnel").first();
    // open its kebab, click Set as default
    await firstCol.locator("[data-funnel-kebab]").click();
    await page.locator('[data-board-menu="funnel"]').locator('[data-menu-action="set-default"]').click();
    await expect(page.locator(".lg-col-funnel").first().locator("[data-default-chip]")).toBeVisible({ timeout: 20_000 });

    // now delete the DEFAULT funnel -> A-5 guard dialog, verbatim
    const defaultCol = page.locator(".lg-col-funnel").first();
    await defaultCol.locator("[data-funnel-kebab]").click();
    await page.locator('[data-board-menu="funnel"]').locator('[data-menu-action="delete"]').click();
    const guard = page.locator("[data-board-guard]");
    await expect(guard).toBeVisible({ timeout: 20_000 });
    await expect(guard.locator("[data-board-guard-body]")).toContainText("it is the default funnel.");
  });

  test("inline rename persists across reload", async ({ page }) => {
    const quote = await seedQuote(apiCtx);
    await openEditor(page, quote.public_id);
    const name = page.locator(".lg-col-funnel [data-funnel-name]").first();
    await name.click(); // begins the contenteditable rename (island beginRename)
    await name.selectText();
    await page.keyboard.type("Renamed Funnel");
    await page.keyboard.press("Enter"); // island PATCH /funnels/:id -> reloads the page itself
    // Assert after the island's own reload (no manual goto — that would race it).
    await expect(page.locator(".lg-col-funnel [data-funnel-name]", { hasText: "Renamed Funnel" })).toBeVisible({ timeout: 20_000 });
  });

  test("A/B badge navigates to the A/B tab", async ({ page }) => {
    const quote = await seedQuote(apiCtx);
    await openEditor(page, quote.public_id);
    await page.locator(".lg-col-funnel [data-ab-badge]").first().click();
    await expect(page.locator("[data-panel='ab']")).toBeVisible({ timeout: 10_000 });
  });

  test("cross-funnel chip drag is rejected (no move; inline hint)", async ({ page }) => {
    const a = await createSection(apiCtx, "Chip A");
    const quote = await seedQuote(apiCtx);
    await json(await apiCtx.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: a.public_id }] }] },
    }), "seed page");
    await json(await apiCtx.post(`${LG_API}/quotes/${quote.public_id}/funnels`, { data: { funnel_name: "Other funnel" } }), "funnel 2");
    await openEditor(page, quote.public_id);

    const srcChipGrip = page.locator(".lg-col-funnel").first().locator("[data-sec-chip] [data-chip-grip]").first();
    const otherCol = page.locator(".lg-col-funnel").nth(1);
    await dragCenterToCenter(page, srcChipGrip, otherCol);
    // rejected: an inline hint shows and the chip did NOT move into the other funnel
    await expect(page.locator(".lg-board-inline-err")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".lg-col-funnel").nth(1).locator("[data-sec-chip]")).toHaveCount(0);
  });

  // P3b adversarial-review finding (P2-D): §4.3-13 section uniqueness
  // (Appendix A-4, verbatim) — a section id may appear at most once within a
  // single funnel's plan. The board has NO client-side duplicate guard for a
  // library->page drop (addSectionToFunnelPage pushes the slot unconditionally
  // — see funnel.ts's onDragUp 'lib' branch); the server is the ONLY gate
  // (quotes-handlers.ts variantSaveUniquenessErrors / A4_SECTION_DUP), and its
  // 400 `fields` message is rendered inline via showInlineErr(firstFieldError).
  // Dropping a library card for a section ALREADY on this funnel (even onto
  // the SAME page it's already on) reaches the server and must render that
  // EXACT verbatim message — proving the rejection round-trips through a real
  // PUT, not merely that the server API returns it in isolation.
  test("dropping a duplicate section onto its own funnel renders the server's A-4 message inline (no duplicate chip)", async ({ page }) => {
    const dup = await createSection(apiCtx, "Dup Section");
    const quote = await seedQuote(apiCtx);
    await json(await apiCtx.put(`${LG_API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, {
      data: { pages: [{ name: null, slots: [{ kind: "fixed", section_id: dup.public_id }] }] },
    }), "seed page");
    await openEditor(page, quote.public_id);

    const libCard = page.locator(`[data-lib-card][data-section-public-id="${dup.public_id}"]`);
    const pageCard = page.locator(".lg-col-funnel [data-page-card]").first();
    await expect(libCard).toBeVisible();
    await expect(pageCard.locator("[data-sec-chip]")).toHaveCount(1);

    // Drop the SAME (already-in-this-funnel) library card onto its own page —
    // the client sends the PUT unconditionally; the server's A-4 uniqueness
    // check (§4.3-13) rejects it.
    await dragCenterToCenter(page, libCard, pageCard);
    const err = page.locator(".lg-board-inline-err");
    await expect(err).toBeVisible({ timeout: 20_000 });
    await expect(err).toContainText("is already in this funnel");
    await expect(err).toContainText(dup.name);
    // rejected: the page still shows exactly the ONE original chip, never two.
    await expect(pageCard.locator("[data-sec-chip]")).toHaveCount(1);
  });

  // P3b relocation round (§8.2 CONDUCTOR RULING): the funnel column's kebab now
  // carries the relocated "Funnel settings" (opening-lander + base design +
  // per-variant auction), opening a dialog in the board's delete-guard dialog
  // vocabulary. Persistence is API + reload (the board's contract): the island
  // PUTs the funnel's active variant through the EXISTING /variants/:id fields,
  // then reloads; the edited values survive the round-trip.
  test("funnel kebab -> Funnel settings: edit headline + toggle lander, save, persists across reload", async ({ page }) => {
    const quote = await seedQuote(apiCtx);
    await openEditor(page, quote.public_id);

    // open the funnel kebab -> Funnel settings
    await page.locator(".lg-col-funnel").first().locator("[data-funnel-kebab]").click();
    await page.locator('[data-board-menu="funnel"]').locator('[data-menu-action="funnel-settings"]').click();
    await expect(page.locator("[data-funnel-settings]")).toBeVisible();

    // edit the lander headline + enable the opening lander (fresh variant = off)
    await expect(page.locator("#lg-lander-enabled")).not.toBeChecked();
    await page.locator("#lg-lander-headline").fill("Persisted Headline");
    await page.locator("#lg-lander-enabled").check();

    // save -> island PUT /variants/:id -> reloadPage(); the SSR dialog re-renders
    // hidden, which gates the reload (the pre-reload dialog is still visible).
    await page.locator("[data-funnel-settings-save]").click();
    await expect(page.locator("[data-funnel-settings]")).toBeHidden({ timeout: 20_000 });

    // re-open from the kebab: the values persisted through the round-trip
    // (SSR + blob rebuilt from the saved variant).
    await page.locator(".lg-col-funnel").first().locator("[data-funnel-kebab]").click();
    await page.locator('[data-board-menu="funnel"]').locator('[data-menu-action="funnel-settings"]').click();
    await expect(page.locator("[data-funnel-settings]")).toBeVisible();
    await expect(page.locator("#lg-lander-headline")).toHaveValue("Persisted Headline");
    await expect(page.locator("#lg-lander-enabled")).toBeChecked();
  });
});
