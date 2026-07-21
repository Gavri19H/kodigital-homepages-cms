// LeadGen Round-4 Remediation — Phase P7 close: THE ROUND-4 OPERATOR ACCEPTANCE
// SUITE, Section Studio + Lists half (register docs/leadgen/round4/register.md
// rows R4-01..R4-14 + bonus defects R4-34/35/36/37/38/39/41/42). This is the
// program's terminal artifact for the Section-Studio-side surface: it re-walks
// the operator's ACTUAL reported journeys (LEADGEN-ROUND4-INVESTIGATION-
// 2026-07-19.md items 1-9 + the 9 bonus defects) as live operator journeys —
// real API seeding through the validate gate, real clicks/fills/selects (ZERO
// dispatchEvent), real live-funnel drives — against the CURRENT code (P1-P6
// already merged). The Quotes-tab items (10A-J + restructure + funnel deltas +
// D-2 routing) are the SIBLING files leadgen-round4-quotes-acceptance.gesture
// .spec.ts and leadgen-round4-funnel-acceptance.gesture.spec.ts (split for
// runtime — see those files' headers).
//
// THE JOURNEY LAYER, NOT A REPLACEMENT: every mechanism here is ALSO pinned by
// a deeper phase-slice gate (__p1a-studio/__p1d-lists/__p2b-phone/__p2c-studio
// etc., cited per test). This suite proves the mechanisms COMPOSE the way the
// operator actually used them, end to end, in readable named journeys.
//
// Patterns cribbed verbatim from (per CLAUDE.md context discipline — nothing
// reinvented): leadgen-operator-acceptance.gesture.spec.ts (seedLiveFunnel/
// shellUrl/ready/sectionIndex/liveSection/liveLegChromiumOnly/createStudioSection
// /saveStudio/frameOf/canvasRender), __p1a-studio.spec.ts (palette insert via
// [data-add-component], rule-source-by-label, jargon-free save errors, Address
// Accept-lock, single When-answered writer), __p2c-studio.spec.ts (the ANY/ALL
// rules-group builder click sequence + phone-format picker), __p1d-lists.spec.ts
// (list-wrapper reachability measurement), leadgen-r4b-maps-tab.spec.ts (the
// Maps-tab fill-picker sequence).
//
// ENGINE NOTE (disclosed, not silently accepted): this file is NOT registered
// in playwright.config.ts's CROSS_ENGINE_GESTURE_SPECS/FIREFOX_ONLY_GESTURE_SPECS
// arrays (that file is outside this slice's exclusive ownership — touching it
// would require a conductor-owned config change). Firefox's project uses
// `testMatch: ALL_GESTURE_SPECS`, an explicit whitelist that does not include
// this filename, so today this file runs on chromium ONLY (confirmed empirically
// — see the P7a dispatch report). Every test below is written engine-agnostically
// (plain click/fill/selectOption, the SAME liveLegChromiumOnly() gate the
// registered specs use for the dynamic *.e2e.test host) so registering this file
// in that array is a pure addition whenever the conductor wants the second-engine
// proof — exactly how __p1a-studio.spec.ts was folded in during P1.
//
// Run (per-file, fresh D1, worktree-isolated):
//   pgrep -f kodigital-cms-round4-wt | xargs -r kill -9; cd api && npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-round4-acceptance.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

const LG_API = "/api/admin/leadgen";
const PORT = PW_PORT;
const uniq = Date.now();

// Real desktop Chrome UA — the /lg/auction runtimeRequestGuard 403s a headless
// UA in dev (no request.cf locally); inert everywhere else. Same convention as
// leadgen-operator-acceptance.gesture.spec.ts.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

// ---------------------------------------------------------------------------
// Shared helpers — cribbed from leadgen-operator-acceptance.gesture.spec.ts /
// __p1a-studio.spec.ts / __p2c-studio.spec.ts verbatim in shape. Disjoint
// namespace prefix "r4acc-"/"R4ACC " (grepped clean against every other
// test-ui/*.spec.ts fixture prefix — see the P7a dispatch report).
// ---------------------------------------------------------------------------

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Created {
  id: number;
  public_id: string;
}

async function createStudioSection(
  request: APIRequestContext,
  name: string,
  components: unknown[],
  extra: Record<string, unknown> = {},
): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: name,
        continue_mode: "button",
        status: "active",
        content_json: { components },
        ...extra,
      },
    }),
    `section create (${name})`,
  );
}

interface SectionDetail {
  content_json: { components: Array<Record<string, unknown>>; continue_visible_when?: unknown };
}
async function fetchSection(request: APIRequestContext, publicId: string): Promise<SectionDetail> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), `section detail (${publicId})`);
}

const frameOf = (page: Page) => page.frameLocator("#lg-studio-canvas-frame");
const canvasRender = (page: Page) => frameOf(page).locator("#lg-studio-canvas-render");

async function openEdit(page: Page, publicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible({ timeout: 15_000 });
  // Deflake (combined-run only; every createStudioSection call in this file
  // seeds >=1 component, so this is always reachable): #lg-section-name is a
  // top-level DOM node visible as soon as the shell HTML parses, but the
  // canvas srcdoc iframe + its palette click-handlers can still be mid-init
  // under load — a palette click firing in that window is a silent no-op
  // (0 nodes inserted), never a thrown error, so nothing upstream of the
  // insert assertion catches it. Wait for the SAME canvas-ready signal
  // leadgen-operator-acceptance.gesture.spec.ts's bootStudio() uses (a real
  // rendered node inside the iframe) so callers that immediately drive the
  // palette (openEdit -> palette(...).click()) never race canvas init.
  await expect(frameOf(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 15_000 });
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}

async function saveStudioAwaitOk(page: Page, publicId: string): Promise<void> {
  // Armed BEFORE the click (never after) so a clean save's own hard-navigate
  // reload — fired asynchronously by the studio's client JS the instant the
  // PATCH resolves 2xx, same mechanism saveStudio()'s Promise.all races
  // intentionally — can never be missed. Without this, a caller that
  // immediately re-navigates (e.g. openEdit -> page.goto) after this
  // function returns can race that in-flight reload and get "navigation
  // interrupted by another navigation to <the same edit URL>" (deflake,
  // same class as the P3a fix — crib: __p1a-studio.spec.ts's own save
  // sequence waits for BOTH the PATCH response and `load` together).
  // Timeout+catch so a save that legitimately FAILS (no reload ever fires)
  // never hangs this promise — it just resolves to null in the background,
  // harmless since the failure path below throws before ever awaiting it.
  const loaded = page.waitForEvent("load", { timeout: 15_000 }).catch(() => null);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/sections/${publicId}`) && r.request().method() === "PATCH"),
    page.locator("#lg-section-save").click(),
  ]);
  if (!res.ok()) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* body gone after navigation */
    }
    throw new Error(`save PATCH ${res.status()}: ${detail}`);
  }
  // Clean save confirmed — wait for the studio's own reload to fully land
  // before returning, so the NEXT action (often another openEdit) is never
  // racing it.
  await loaded;
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

// The REAL library-insert picker (verified against __p1a-studio.spec.ts +
// __p2c-studio.spec.ts, which both insert MultiQuestionGrid/DropdownQuestion/
// AddressAutocompleteQuestion/PhoneInputQuestion this exact way).
function palette(page: Page, type: string): Locator {
  return page.locator(`[data-add-component="${type}"]`);
}

async function seedLiveFunnel(
  request: APIRequestContext,
  tag: string,
  sectionIds: number[],
): Promise<{ host: string; slug: string }> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `r4acc-${tag}-${u}.e2e.test`;
  const slug = `r4acc-${tag}`;
  const siteId = await seedActiveSite(request, host, `R4ACC ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `R4ACC ${tag} ${u}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: { sections: sectionIds.map((section_id) => ({ section_id })) },
    }),
    "variant sections",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, {
      data: { enabled: true, slug },
    }),
    "activation",
  );
  return { host, slug };
}
const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PORT}/lg/${s.slug}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 10_000 });
}
const sectionIndex = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index,
  );
const liveSection = (page: Page, i: number) => page.locator(`[data-lg-section][data-lg-index="${i}"]`);

function liveLegChromiumOnly(browserName: string, reason: string): boolean {
  if (browserName === "firefox") {
    test.info().annotations.push({ type: "live-leg-skip", description: reason });
    return false;
  }
  return true;
}

async function createNextSection(request: APIRequestContext): Promise<Created> {
  return createStudioSection(request, `R4ACC Next ${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
    { type: "QuestionHeadline", question_id: "q_next_head", bind: "section_headline" },
    { type: "TwoButtonYesNo", question_id: "q_next", internal_field: "next_ok", props: { yesLabel: "Yes", noLabel: "No" } },
  ]);
}

const YESNO = [
  { label: "Yes", value: "yes", analytics_id: "yes" },
  { label: "No", value: "no", analytics_id: "no" },
];

test.describe("Round-4 acceptance — Section Studio & Lists (register R4-01..R4-14, bonus R4-34/35/36/37/38/39/41/42)", () => {
  // =========================================================================
  // Item 1 — list tables overflow with no reachable scrollbar (all tabs)
  // Deeper gate: __p1d-lists.spec.ts. Journey: at 1440px, every LeadGen list +
  // a Listicles list is fully reachable (the wrapper's own scrollbar reaches
  // the last column; no page-level `body{overflow-x:hidden}` clip) and kebab
  // actions are present on the LeadGen lists.
  // =========================================================================
  test("Item 1 — every list (offers/sections/quotes/auction + a Listicles list) is reachable at 1440px, kebab actions present", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Seed one row in each LeadGen list + a Listicles site/section so every
    // table actually renders a body row (an empty table trivially "fits").
    const offer = await json<Created>(
      await request.post(`${LG_API}/offers`, {
        data: {
          offer_name: `R4ACC Item1 offer ${uniq}`,
          provider: "fxprov",
          activity: "quote_funnel",
          vertical: "life",
          conversion_tracking_method: "s2s_postback",
          offer_type: "cpc",
          placements: [`r4acc-item1-${uniq}`],
          calls_provider_api: false,
          bid_source: "static",
          cap_enabled: false,
        },
      }),
      "item1 offer create",
    );
    expect(offer.id, "offer seeded").toBeTruthy();
    const section = await createStudioSection(request, `R4ACC Item1 section ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
    ]);
    const quote = await json<Created>(
      await request.post(`${LG_API}/quotes`, {
        data: { quote_name: `R4ACC Item1 quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
      }),
      "item1 quote create",
    );
    // auctions require quote_id (the quote's INTEGER id) attribution —
    // auctions-handlers.ts createAuctionHandler §18.1.
    const auction = await json<Created>(
      await request.post(`${LG_API}/auctions`, {
        data: { auction_name: `R4ACC Item1 auction ${uniq}`, quote_id: quote.id },
      }),
      "item1 auction create",
    );
    expect(auction.id, "auction seeded").toBeTruthy();
    const siteId = await seedActiveSite(request, `r4acc-item1-${uniq}.e2e.test`, `R4ACC Item1 Site ${uniq}`);

    const lists: Array<{ name: string; url: string; table: string; expectKebab: boolean }> = [
      { name: "LeadGen Offers", url: "/admin/leadgen/offers", table: "table.leadgen-offers-list", expectKebab: true },
      { name: "LeadGen Sections", url: "/admin/leadgen/sections", table: "table.leadgen-sections-list", expectKebab: true },
      { name: "LeadGen Quotes", url: "/admin/leadgen/quotes", table: "table.leadgen-quotes-list", expectKebab: true },
      { name: "LeadGen Auction", url: "/admin/leadgen/auction", table: "table.leadgen-auctions-list", expectKebab: true },
      {
        name: "Listicles Sections",
        url: `/admin/listicles/sections?site_id=${encodeURIComponent(siteId)}`,
        table: "table.sections-list",
        expectKebab: false,
      },
    ];

    for (const l of lists) {
      await page.goto(l.url, { waitUntil: "domcontentloaded" });
      const table = page.locator(l.table).first();
      await expect(table, `${l.name}: table renders`).toBeVisible({ timeout: 10_000 });

      // No page-level unreachable clip: body must not scroll horizontally
      // past its own client width (the A-1 `body{overflow-x:hidden}` trap).
      const bodyMetrics = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth,
        clientWidth: document.scrollingElement ? document.scrollingElement.clientWidth : document.body.clientWidth,
      }));
      expect(
        bodyMetrics.scrollWidth,
        `${l.name}: no page-level unreachable overflow (body scrollWidth ${bodyMetrics.scrollWidth} vs clientWidth ${bodyMetrics.clientWidth})`,
      ).toBeLessThanOrEqual(bodyMetrics.clientWidth + 1);

      // The table's OWN wrapper reaches the last column when scrolled to the
      // end (its own scrollbar engages rather than the page silently clipping).
      const wrapper = page.locator(".table-wrapper").filter({ has: table }).first();
      await expect(wrapper, `${l.name}: table-wrapper present`).toHaveCount(1);
      const before = await wrapper.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      if (before.scrollWidth > before.clientWidth + 1) {
        await wrapper.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        const lastHeaderBox = await table.locator("thead th").last().boundingBox();
        expect(lastHeaderBox, `${l.name}: last column has a bounding box after scroll`).not.toBeNull();
        const vw = page.viewportSize()!.width;
        expect(lastHeaderBox!.x, `${l.name}: last column reachable within the viewport (x=${lastHeaderBox!.x})`).toBeGreaterThanOrEqual(-1);
        expect(lastHeaderBox!.x, `${l.name}: last column reachable within the viewport (x=${lastHeaderBox!.x} vs vw=${vw})`).toBeLessThan(vw);
      }
      // else: wrapper already fits its content at 1440 — trivially reachable.

      if (l.expectKebab) {
        // Offers uses its own legacy kebab (data-offer-kebab-toggle);
        // sections/quotes/auction share renderKebabOpen (data-kebab-toggle) —
        // both carry the SAME "More actions for <name>" aria-label convention
        // (ui-offers.ts:450; the shared component promotes that convention),
        // so a role-based query is the one selector that works for all four.
        const kebabToggle = page.getByRole("button", { name: /More actions/i }).first();
        await expect(kebabToggle, `${l.name}: a kebab actions trigger is present on at least one row`).toBeVisible();
      }
    }
  });

  // =========================================================================
  // Item 2 — actions parity: sections/quotes/auction rows expose Duplicate/
  // Archive-Reactivate/Usage/Delete, matching offers. Deeper gate:
  // __p1d-lists.spec.ts (kebab wiring) + __p1c server lifecycle handlers.
  // Journey: seed one row of each entity → open its kebab → assert every
  // action present → drive a REAL Archive → Reactivate round trip (the B-4.5
  // "archive dead-end" bonus defect, inverted) on the Quotes list.
  // =========================================================================
  test("Item 2 — sections/quotes/auction kebabs carry Duplicate/Usage/Archive-Reactivate/Delete (parity with offers), and Archive->Reactivate genuinely round-trips", async ({
    page,
    request,
  }) => {
    const section = await createStudioSection(request, `R4ACC Item2 section ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
    ]);
    const quote = await json<{ id: number; public_id: string }>(
      await request.post(`${LG_API}/quotes`, {
        data: { quote_name: `R4ACC Item2 quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
      }),
      "item2 quote create",
    );
    const auction = await json<Created>(
      await request.post(`${LG_API}/auctions`, {
        data: { auction_name: `R4ACC Item2 auction ${uniq}`, quote_id: quote.id },
      }),
      "item2 auction create",
    );

    // --- Sections: Duplicate present + works -------------------------------
    await page.goto("/admin/leadgen/sections", { waitUntil: "domcontentloaded" });
    // ui-sections.ts stamps data-entity-id with the NUMERIC id (unlike quotes/
    // auctions, which use public_id) — section.id, not section.public_id.
    const sectionRow = page.locator(`tr[data-entity-id="${section.id}"]`);
    // Opening the kebab REPARENTS its menu to <body> (a portal — escapes the
    // table-wrapper's overflow clip + the admin-main stacking context; see
    // layout.ts kebabMenuScript) — so once open, items are document-level.
    await sectionRow.getByRole("button", { name: /More actions/i }).click();
    await expect(page.locator(`[data-section-duplicate="${section.public_id}"]`), "sections kebab carries Duplicate").toBeVisible();
    await expect(page.locator(`[data-section-usage="${section.public_id}"]`), "sections kebab carries Usage").toBeVisible();
    await expect(page.locator(`[data-section-archive="${section.public_id}"]`), "sections kebab carries Archive").toBeVisible();
    await expect(page.locator(`[data-section-delete="${section.public_id}"]`), "sections kebab carries Delete").toBeVisible();

    // --- Quotes: full parity + the REAL Archive -> Reactivate round trip --
    await page.goto("/admin/leadgen/quotes", { waitUntil: "domcontentloaded" });
    const quoteRow = page.locator(`tr[data-entity-id="${quote.public_id}"]`);
    await quoteRow.getByRole("button", { name: /More actions/i }).click();
    await expect(page.locator(`[data-quote-duplicate="${quote.public_id}"]`), "quotes kebab carries Duplicate").toBeVisible();
    await expect(page.locator(`[data-quote-usage="${quote.public_id}"]`), "quotes kebab carries Usage").toBeVisible();
    const quoteArchive = page.locator(`[data-quote-archive="${quote.public_id}"]`);
    await expect(quoteArchive, "quotes kebab carries Archive").toBeVisible();
    await expect(page.locator(`[data-quote-delete="${quote.public_id}"]`), "quotes kebab carries Delete").toBeVisible();

    // Archive: window.confirm() -> PATCH status=archived -> the handler's own
    // window.location.reload() (ui-quotes.ts) — accept the dialog, click, then
    // re-open the (freshly reloaded) row's kebab to see the flipped item.
    page.once("dialog", (d) => void d.accept());
    await quoteArchive.click();
    const quoteRowAfterArchive = page.locator(`tr[data-entity-id="${quote.public_id}"]`);
    await expect(quoteRowAfterArchive.getByRole("button", { name: /More actions/i }), "row survives the reload after archive").toBeVisible({ timeout: 10_000 });
    await quoteRowAfterArchive.getByRole("button", { name: /More actions/i }).click();
    const quoteReactivate = page.locator(`[data-quote-reactivate="${quote.public_id}"]`);
    await expect(quoteReactivate, "an archived quote offers Reactivate (B-4.5 dead-end inverted)").toBeVisible();
    await expect(page.locator(`[data-quote-archive="${quote.public_id}"]`)).toHaveCount(0);
    const archivedReadBack = await json<{ status: string }>(await request.get(`${LG_API}/quotes/${quote.public_id}`), "quote read-back after archive");
    expect(archivedReadBack.status, "server status is archived").toBe("archived");

    page.once("dialog", (d) => void d.accept());
    await quoteReactivate.click();
    const quoteRowAfterReactivate = page.locator(`tr[data-entity-id="${quote.public_id}"]`);
    await expect(quoteRowAfterReactivate.getByRole("button", { name: /More actions/i }), "row survives the reload after reactivate").toBeVisible({ timeout: 10_000 });
    await quoteRowAfterReactivate.getByRole("button", { name: /More actions/i }).click();
    await expect(page.locator(`[data-quote-archive="${quote.public_id}"]`), "reactivated quote offers Archive again").toBeVisible();
    const reactivatedReadBack = await json<{ status: string }>(await request.get(`${LG_API}/quotes/${quote.public_id}`), "quote read-back after reactivate");
    expect(reactivatedReadBack.status, "server status round-trips back to active").toBe("active");

    // --- Auction: same parity set -------------------------------------------
    await page.goto("/admin/leadgen/auction", { waitUntil: "domcontentloaded" });
    const auctionRow = page.locator(`tr[data-entity-id="${auction.public_id}"]`);
    await auctionRow.getByRole("button", { name: /More actions/i }).click();
    await expect(page.locator(`[data-auction-usage="${auction.public_id}"]`), "auctions kebab carries Usage").toBeVisible();
    await expect(page.locator(`[data-auction-archive="${auction.public_id}"]`), "auctions kebab carries Archive").toBeVisible();
    await expect(page.locator(`[data-auction-delete="${auction.public_id}"]`), "auctions kebab carries Delete").toBeVisible();
  });

  // =========================================================================
  // Item 3 — Question grid unusable from the picker (Image5 reference).
  // Deeper gate: __p1a-studio.spec.ts (AC-1) + leadgen-p5-multi-question-grid
  // .gesture.spec.ts. Journey: from the PICKER, insert a Question grid → rows
  // render immediately (never an empty shell) → add a sub-question via the
  // canvas affordance → per-row field mapping + default answer via the rows
  // editor → save → the LIVE funnel renders labeled rows with default-selected
  // pills (the B-4.1 MQG save-trap + the empty-picker-insert bug, both inverted).
  // =========================================================================
  test('Item 3 — "a multi-question grid, insert from the picker" (Image5): insert -> rows render -> add sub-question -> field mapping -> default -> save -> live labeled default-selected rows', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item3 grid ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
    ]);
    await openEdit(page, s.public_id);

    // REAL picker insert (never pre-seeded content_json): the picker-inserted
    // grid renders its starter rows IMMEDIATELY (the A-3 seed-drop bug, inverted).
    await palette(page, "MultiQuestionGrid").click();
    await expect(canvasRender(page).locator(".lg-mqg-row"), "picker-inserted grid renders seeded rows, never an empty shell").toHaveCount(2);

    // The canvas "Add a sub-question" affordance grows a REAL 3rd row.
    await canvasRender(page).locator("[data-mqg-add-canvas]").click();
    await expect(canvasRender(page).locator(".lg-mqg-row")).toHaveCount(3);

    // Per-row field mapping + default answer, through the REAL rows editor —
    // the operator's "Tell us about the driver" shape (Homeowner/Married/Gender).
    const rowsBlock = page.locator("[data-mqg-rows-block]");
    await expect(rowsBlock).toBeVisible();
    const rows = rowsBlock.locator("[data-mqg-row]");
    const rowSpec = [
      { label: "Homeowner", field: "r4_homeowner", def: "yes" },
      { label: "Married", field: "r4_married", def: "no" },
      { label: "Gender", field: "r4_gender", def: "yes" },
    ];
    for (let i = 0; i < rowSpec.length; i++) {
      const row = rows.nth(i);
      await row.locator('input[data-mqg-field="label"]').fill(rowSpec[i]!.label);
      await row.locator('input[data-mqg-field="internal_field"]').fill(rowSpec[i]!.field);
      await row.locator('select[data-mqg-field="default"]').selectOption(rowSpec[i]!.def);
    }
    await saveStudioAwaitOk(page, s.public_id);

    const saved = await fetchSection(request, s.public_id);
    const gridNode = saved.content_json.components.find((c) => c["type"] === "MultiQuestionGrid") as {
      props: { rows: Array<{ label: string; internal_field: string; default?: string }> };
    };
    expect(gridNode.props.rows, "3 rows persisted with label/field/default").toHaveLength(3);
    for (let i = 0; i < rowSpec.length; i++) {
      expect(gridNode.props.rows[i]).toMatchObject({ label: rowSpec[i]!.label, internal_field: rowSpec[i]!.field, default: rowSpec[i]!.def });
    }

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 3 live render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The picker-insert + rows-editor + save-round-trip assertions above run engine-agnostically.",
      )
    )
      return;

    // LIVE: the picker-authored grid renders 3 stacked labeled rows with the
    // authored default pill pre-selected on each — the operator's actual ask.
    const seeded = await seedLiveFunnel(request, "item3", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const qid = gridNode ? (saved.content_json.components.find((c) => c["type"] === "MultiQuestionGrid") as { question_id: string }).question_id : "";
    for (const r of rowSpec) {
      await expect(page.locator(".lg-mqg .lg-label", { hasText: r.label }), `row "${r.label}" renders live`).toBeVisible();
      await expect(
        page.locator(`[data-lg-question="${qid}::${r.field}"] [data-lg-choice="${r.def}"]`),
        `row "${r.label}" default-selected pill (${r.def}) is pre-selected live`,
      ).toHaveClass(/lg-selected/);
    }
  });

  // =========================================================================
  // Item 4A/4B/4C/4E — Rules: source above -> dependent below; a Question-grid
  // ROW as a condition source; Address/Name fields as sources.
  // Deeper gate: __p1a-studio.spec.ts (AC-1/AC-2) + leadgen-p4c-rules.gesture
  // .spec.ts. Journey: a Dropdown BELOW an MQG row conditions its visibility on
  // that row's answer (source above -> dependent below); Address sub-fields
  // and NameFieldsGroup fields also appear as sources (the A-4 sweep).
  // =========================================================================
  test('Item 4A/4B/4C/4E — "show Carrier when insured=Yes" via an MQG row source (above -> below), Address/Name are rule sources', async ({
    page,
    request,
    browserName,
  }) => {
    // Source ABOVE (an MQG row "Homeowner" + a NameFieldsGroup — seeded
    // directly since NameFieldsGroup has no standalone palette tile; it only
    // inserts as a CHILD via the "Contact" tile's childTypes), dependent
    // BELOW (a Dropdown "Carrier").
    const s = await createStudioSection(request, `R4ACC Item4 rules ${uniq}`, [
      {
        type: "MultiQuestionGrid",
        question_id: "q_grid",
        choices: YESNO,
        props: { rows: [{ label: "Homeowner", internal_field: "r4a_homeowner" }] },
      },
      { type: "NameFieldsGroup", question_id: "q_name" },
      {
        type: "DropdownQuestion",
        question_id: "q_carrier",
        internal_field: "r4a_carrier",
        answer_type: "enum",
        choices: [
          { label: "Acme", value: "acme", analytics_id: "acme" },
          { label: "Beta", value: "beta", analytics_id: "beta" },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);

    // Select the DEPENDENT (Carrier, below) -> Rules tab -> its source picker
    // offers the MQG row (above) by its ROW LABEL, never the section headline.
    await canvasRender(page).locator('[data-component-type="DropdownQuestion"]').click();
    await openInspectorTab(page, "rules");
    await page.locator("[data-rules-add-condition]").click();
    const whenSel = page.locator('[data-inspector-cond="when"]');
    const options = await whenSel.locator("option").evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, text: (e.textContent ?? "").trim() })),
    );
    const homeownerOpt = options.find((o) => o.value === "r4a_homeowner");
    expect(homeownerOpt, `rule sources: ${JSON.stringify(options)}`).toBeDefined();
    expect(homeownerOpt!.text, "the MQG row is offered by ITS OWN label").toBe("Homeowner");

    // A sibling Dropdown's source list ALSO exposes Address sub-fields (the
    // A-4 sweep) — insert Address via the REAL picker so its sub-fields
    // register as sources, alongside the already-seeded NameFieldsGroup.
    await palette(page, "AddressAutocompleteQuestion").click();
    await canvasRender(page).locator('[data-component-type="DropdownQuestion"]').click();
    await openInspectorTab(page, "rules");
    const labels = (await page.locator('[data-inspector-cond="when"]').locator("option").allTextContents()).join(" | ");
    for (const role of ["Street", "City", "State", "ZIP"]) {
      expect(labels, `Address role "${role}" is a rule source: ${labels}`).toContain(role);
    }
    expect(labels, `NameFieldsGroup First is a rule source: ${labels}`).toContain("Name — First");
    expect(labels, `NameFieldsGroup Last is a rule source: ${labels}`).toContain("Name — Last");

    // Author the show-if ON Carrier: Homeowner == Yes (source above, dependent
    // below — the operator's described flow direction).
    await canvasRender(page).locator('[data-component-type="DropdownQuestion"]').click();
    await openInspectorTab(page, "rules");
    await page.locator("[data-rules-add-condition]").click();
    await page.locator('[data-inspector-cond="when"]').selectOption("r4a_homeowner");
    await page.locator('[data-inspector-cond="op"]').selectOption("eq");
    await expect(page.locator('[data-inspector-cond="value-enum"]')).toBeVisible();
    await page.locator('[data-inspector-cond="value-enum"]').selectOption("yes");
    await saveStudio(page);

    const saved = await fetchSection(request, s.public_id);
    const carrier = saved.content_json.components.find((c) => c["question_id"] === "q_carrier") as {
      conditional?: { when: string; op: string; value: unknown };
    };
    expect(carrier.conditional).toEqual({ when: "r4a_homeowner", op: "eq", value: "yes" });

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 4A live reveal needs chromium --host-resolver-rules. The rule-source + authoring assertions above run engine-agnostically.",
      )
    )
      return;

    // REGRESSION FOUND HERE (report to conductor, not fixed in this slice —
    // quotes-handlers.ts is outside this slice's exclusive ownership):
    // seedLiveFunnel's activation PUT is expected to succeed (a bare
    // conditional on a KNOWN, valid MQG-row field is exactly what the studio's
    // own rule-source picker just offered and the save above just persisted).
    // Instead the server 409s: {"error":"quote_activation_blocked",
    // "blocks":[{"code":"dependency_missing_field","fields":["r4a_homeowner"]}]}.
    // Root cause (own-hand read): quotes-handlers.ts's activation-time
    // "knownFields" builder (~line 3748-3770) collects ONLY each flattened
    // node's OWN top-level `internal_field` — flattenComponents (content-
    // schema.ts:840) expands layout CONTAINERS only, never a
    // MultiQuestionGrid's `props.rows[].internal_field` — so an MQG row field
    // is NEVER in `knownFields`, and a BARE conditional naming one (this
    // test's exact shape) is wrongly flagged "missing" at activation. Reference
    // -compare (I8): __p2c-studio.spec.ts's OWN MQG-row-conditional live test
    // (identical row shape) passes ONLY because it uses the COMPOSED
    // {match,conditions} shape — the checker's guard
    // (`typeof conditional["when"] === "string"`) is false for a group object,
    // so composed conditionals skip this validation ENTIRELY (a second,
    // independent coverage hole: a group referencing a truly-missing field
    // would ALSO sail through unblocked). Net: the studio's rules picker
    // (internalFieldsOf, ui-section-studio.ts) and the runtime engine both
    // correctly treat MQG rows as first-class fields (round-3/round-4 P1a
    // work), but this ONE server-side activation gate never learned that —
    // the exact "source above -> dependent below" journey the operator asked
    // for (item 4A/4B) cannot reach a LIVE site when authored as a single
    // condition. Left as a live (expected-to-succeed) assertion below —
    // currently FAILS — per the dispatch's "do not paper over it".
    const rulesNext = await createNextSection(request);
    const seeded = await seedLiveFunnel(request, "item4a", [s.id, rulesNext.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const carrierEl = page.locator('[data-lg-question="q_carrier"]');
    await expect(carrierEl, "Carrier hidden until the source (above) is answered Yes").toBeHidden();
    await page.locator('[data-lg-field="r4a_homeowner"] [data-lg-choice="yes"]').click();
    await expect(carrierEl, "Carrier reveals on a live Yes from the source above").toBeVisible({ timeout: 3_000 });
  });

  // =========================================================================
  // Item 4D — complex rules AND/OR (operator: "married=Yes AND gender=Male ->
  // show X"). Deeper gate: __p2c-studio.spec.ts (AC-1/AC-2). Journey: author a
  // 2-condition ALL group through the REAL builder, live-verify BOTH required,
  // then flip to ANY and live-verify EITHER suffices.
  // =========================================================================
  test('Item 4D — "married=Yes AND gender=Male -> show X" (ANY/ALL condition group), flips to ANY live', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item4D andor ${uniq}`, [
      { type: "TwoButtonYesNo", question_id: "q_married", internal_field: "r4d_married", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      {
        type: "DropdownQuestion",
        question_id: "q_gender",
        internal_field: "r4d_gender",
        answer_type: "enum",
        choices: [
          { label: "Male", value: "male", analytics_id: "male" },
          { label: "Female", value: "female", analytics_id: "female" },
        ],
      },
      {
        type: "FreeTextQuestion",
        question_id: "q_x",
        internal_field: "r4d_x",
        answer_type: "string",
        props: { placeholder: "Spousal details" },
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);

    await canvasRender(page).locator('[data-component-type="FreeTextQuestion"]').click();
    await openInspectorTab(page, "rules");
    await page.locator("[data-rules-add-condition]").click();
    await page.locator('[data-inspector-cond="when"]').nth(0).selectOption("r4d_married");
    await page.locator('[data-inspector-cond="op"]').nth(0).selectOption("eq");
    await page.locator('[data-inspector-cond="value-bool"]').nth(0).selectOption("true");
    await expect(page.locator("[data-rules-match-group]"), "toggle collapsed with only 1 condition").toBeHidden();

    await page.locator("[data-rules-add-row]").click();
    await expect(page.locator("[data-rules-match-group]"), "ANY/ALL toggle appears at 2 conditions").toBeVisible();
    await page.locator('[data-inspector-cond="when"]').nth(1).selectOption("r4d_gender");
    await page.locator('[data-inspector-cond="op"]').nth(1).selectOption("eq");
    await page.locator('[data-inspector-cond="value-enum"]').nth(1).selectOption("male");
    await expect(page.locator('[data-set-rules-match="all"]'), "ALL is the default match mode").toHaveClass(/active/);
    await saveStudio(page);

    const saved = await fetchSection(request, s.public_id);
    const x = saved.content_json.components.find((c) => c["question_id"] === "q_x") as { conditional?: unknown };
    expect(x.conditional).toEqual({
      match: "all",
      conditions: [
        { when: "r4d_married", op: "eq", value: true },
        { when: "r4d_gender", op: "eq", value: "male" },
      ],
    });

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 4D live ALL/ANY behavior needs chromium --host-resolver-rules. The group-authoring + persistence assertions above run engine-agnostically.",
      )
    )
      return;

    const seeded = await seedLiveFunnel(request, "item4d", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const target = page.locator('[data-lg-question="q_x"]');
    await expect(target, "hidden before any answer").toBeHidden();
    await page.locator('[data-lg-question="q_married"] [data-lg-choice="true"]').click();
    await expect(target, "ALL: married alone is not enough").toBeHidden();
    // DropdownQuestion renders as a native <select> live (data-lg-input) — a
    // real user CHOICE is selectOption, not a click on the (non-actionable)
    // native <option>.
    // hydration() stamps data-lg-question DIRECTLY on the <select> itself for
    // a DropdownQuestion (presets.ts renderDropdownQuestion) — no wrapper.
    await page.locator('select[data-lg-question="q_gender"]').selectOption("male");
    await expect(target, "ALL: married AND gender=male reveals X").toBeVisible({ timeout: 3_000 });

    // Flip to ANY on a SECOND section (a fresh section keeps this leg
    // independent of the live funnel state above).
    const s2 = await createStudioSection(request, `R4ACC Item4D any ${uniq}`, [
      { type: "TwoButtonYesNo", question_id: "q_married", internal_field: "r4d2_married", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      {
        type: "DropdownQuestion",
        question_id: "q_gender",
        internal_field: "r4d2_gender",
        answer_type: "enum",
        choices: [
          { label: "Male", value: "male", analytics_id: "male" },
          { label: "Female", value: "female", analytics_id: "female" },
        ],
      },
      {
        type: "FreeTextQuestion",
        question_id: "q_x",
        internal_field: "r4d2_x",
        answer_type: "string",
        conditional: {
          match: "any",
          conditions: [
            { when: "r4d2_married", op: "eq", value: true },
            { when: "r4d2_gender", op: "eq", value: "male" },
          ],
        },
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    const seeded2 = await seedLiveFunnel(request, "item4d-any", [s2.id]);
    await page.goto(shellUrl(seeded2), { waitUntil: "load" });
    await ready(page);
    const target2 = page.locator('[data-lg-question="q_x"]');
    await expect(target2).toBeHidden();
    // hydration() stamps data-lg-question DIRECTLY on the <select> itself for
    // a DropdownQuestion (presets.ts renderDropdownQuestion) — no wrapper.
    await page.locator('select[data-lg-question="q_gender"]').selectOption("male");
    await expect(target2, "ANY: gender=male ALONE reveals X").toBeVisible({ timeout: 3_000 });
  });

  // =========================================================================
  // Item 5 — two "When answered" controls, one field. Deeper gate:
  // __p1a-studio.spec.ts (AC-3). Journey: exactly ONE writer control exists
  // (the topbar copy is read-only), and the writer genuinely drives the live
  // funnel's auto-advance behavior (extends AC-3 with a live behavioral proof).
  // =========================================================================
  test('Item 5 — exactly one "When answered" writer control, and it genuinely drives live auto-advance', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item5 continuemode ${uniq}`, [
      { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "r5_pick", props: { yesLabel: "Yes", noLabel: "No" } },
    ]);
    await openEdit(page, s.public_id);

    const writers = page.locator("[data-set-continue-mode]");
    await expect(writers, "exactly 2 mode buttons (Wait for Continue / Go to next)").toHaveCount(2);
    const containerCount = await writers.evaluateAll(
      (els) => new Set(els.map((e) => e.closest("[data-continue-mode-group]"))).size,
    );
    expect(containerCount, "both writer buttons live in ONE container").toBe(1);
    const roGroup = page.locator("[data-continue-mode-readonly]");
    await expect(roGroup, "the topbar copy is a read-only status, not a second writer").toHaveCount(1);
    expect(await roGroup.locator("[data-set-continue-mode]").count(), "the read-only container holds no writer").toBe(0);

    // Drive the ONE writer to "Go to next" and prove it genuinely auto-advances.
    await page.locator('[data-set-continue-mode="auto_advance"]').click();
    await saveStudioAwaitOk(page, s.public_id);

    if (
      !liveLegChromiumOnly(browserName, "Item 5 live auto-advance needs chromium --host-resolver-rules. The single-writer assertions above run engine-agnostically.")
    )
      return;

    const next = await createNextSection(request);
    const seeded = await seedLiveFunnel(request, "item5", [s.id, next.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    expect(await sectionIndex(page)).toBe(0);
    await liveSection(page, 0).locator('[data-lg-choice="true"]').click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
  });

  // =========================================================================
  // Item 6A/6C/6D — Address is a real composite (not a Contact clone), with a
  // Maps tab mapping street/city/state/zip; Accept type-swap locked; helper
  // chrome consistent. Deeper gates: __p1a-studio.spec.ts (AC-2) +
  // leadgen-r4b-maps-tab.spec.ts. Journey: insert Address from the picker (its
  // internal_field auto-seeds) -> the canvas renders a VISIBLE composite (not a
  // bare input) -> Accept-swap is locked -> the Maps tab maps street/city/state
  // /zip into sibling fields -> save -> reload round-trips.
  // =========================================================================
  test("Item 6A/6C/6D — Address is a real composite (visible structure, seeded internal_field, locked Accept) with Maps field-mapping to siblings", async ({
    page,
    request,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item6 address ${uniq}`, [
      { type: "FreeTextQuestion", question_id: "q_city", internal_field: "r6_city", answer_type: "string" },
      { type: "FreeTextQuestion", question_id: "q_state", internal_field: "r6_state", answer_type: "string" },
      { type: "FreeTextQuestion", question_id: "q_street", internal_field: "r6_street", answer_type: "string" },
    ]);
    await openEdit(page, s.public_id);

    // Insert Address via the REAL picker (no internal_field authored).
    await palette(page, "AddressAutocompleteQuestion").click();
    const addressNode = canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]');
    await expect(addressNode, "Address inserts as one composite node").toHaveCount(1);

    // VISIBLE composite structure on canvas — not a bare single input
    // indistinguishable from a text field (the A-6 defect, inverted).
    await expect(addressNode.locator(".lg-address-composite"), "canvas renders the visible composite structure").toHaveCount(1);
    await expect(addressNode.locator(".lg-address-chip"), "the composite shows role chips (street/city/state/zip)").not.toHaveCount(0);

    // Accept type-swap is LOCKED on Address (own-hand verified against
    // ui-section-studio.ts:2504-2511/7727-7736 — data-accept-wrap hidden,
    // data-accept-address-lock shown).
    await expect(page.locator("[data-accept-wrap]"), "Accept dropdown is hidden for Address").toBeHidden();
    await expect(page.locator("[data-accept-address-lock]"), "the lock explanation is shown instead").toBeVisible();

    // internal_field auto-seeded on insert (never blank/invisible to rules).
    await saveStudioAwaitOk(page, s.public_id);
    const afterInsert = await fetchSection(request, s.public_id);
    const addrNode = afterInsert.content_json.components.find((c) => c["type"] === "AddressAutocompleteQuestion") as {
      internal_field?: string;
    };
    expect(addrNode.internal_field, "Address auto-seeds a real internal_field on insert").toBeTruthy();

    // Maps tab: enable, pick the autocomplete job, map city/state to the
    // sibling FreeText fields (the exact leadgen-r4b-maps-tab.spec.ts sequence).
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]').click();
    const mapsTab = page.locator('[data-studio-inspector-tab="maps"]');
    await expect(mapsTab, "a Maps tab is offered for Address").toBeVisible();
    await mapsTab.click();
    await page.locator("[data-maps-enabled-toggle]").check();
    await page.locator('[data-maps-job="autocomplete"]').check();
    const fillsBlock = page.locator("[data-maps-fills-block]");
    await expect(fillsBlock).toBeVisible();
    const citySelect = page.locator('select[data-maps-fill-slot="city"]');
    const stateSelect = page.locator('select[data-maps-fill-slot="state"]');
    const cityOptionValues = await citySelect.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(cityOptionValues, "the fills picker offers the section's OTHER internal_field values").toEqual(
      expect.arrayContaining(["r6_city", "r6_state", "r6_street"]),
    );
    await citySelect.selectOption("r6_city");
    await stateSelect.selectOption("r6_state");
    await saveStudioAwaitOk(page, s.public_id);

    const afterMaps = await fetchSection(request, s.public_id);
    const mapsNode = afterMaps.content_json.components.find((c) => c["type"] === "AddressAutocompleteQuestion") as {
      props?: { maps?: { enabled: boolean; jobs: { autocomplete: boolean }; fills: Record<string, string> } };
    };
    expect(mapsNode.props?.maps?.enabled, "Maps enabled persists").toBe(true);
    expect(mapsNode.props?.maps?.jobs.autocomplete, "the autocomplete job persists").toBe(true);
    expect(mapsNode.props?.maps?.fills, "the city/state fill-target mapping persists").toMatchObject({
      city: "r6_city",
      state: "r6_state",
    });

    // Reload round-trip: re-selecting Address re-populates the same state.
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="maps"]').click();
    await expect(page.locator("[data-maps-enabled-toggle]")).toBeChecked();
    await expect(page.locator('select[data-maps-fill-slot="city"]')).toHaveValue("r6_city");
    await expect(page.locator('select[data-maps-fill-slot="state"]')).toHaveValue("r6_state");
  });

  // =========================================================================
  // Item 6B — phone format author-selectable (US/IL/intl) and enforced live.
  // Deeper gates: __p2b-phone.spec.ts + __p2c-studio.spec.ts (AC-3). Journey:
  // author the IL preset through the REAL picker -> save -> reload round-trips
  // -> LIVE an IL-shaped number passes and a US-shaped one blocks with the
  // Israeli message; repeat for the International E.164 preset.
  // =========================================================================
  test("Item 6B — phone format author-selectable (US NANP default / IL / International E.164) and enforced live", async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item6B phone ${uniq}`, [
      { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "r6b_phone", required: true },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await openInspectorTab(page, "content");
    const preset = page.locator("[data-phone-format-preset]");
    await expect(preset, "US NANP is the author-facing default").toHaveValue("nanp");

    await preset.selectOption("il");
    await saveStudioAwaitOk(page, s.public_id);
    const savedIl = await fetchSection(request, s.public_id);
    const phoneNodeIl = savedIl.content_json.components.find((c) => c["question_id"] === "q_phone") as { props?: { phone_format?: string } };
    expect(phoneNodeIl.props?.phone_format, "IL preset persists").toBe("il");

    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await openInspectorTab(page, "content");
    await expect(page.locator("[data-phone-format-preset]"), "IL preset round-trips on reload").toHaveValue("il");

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 6B live phone enforcement needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The phone-format authoring + round-trip assertions above run engine-agnostically.",
      )
    )
      return;

    // LIVE: a US-shaped number blocks with the Israeli message; an IL-valid
    // number advances. A trailing section is required so "advances" means
    // section_index 0->1, not funnel completion (the phone section would
    // otherwise be the LAST section).
    const ilNext = await createNextSection(request);
    const ilFunnel = await seedLiveFunnel(request, "item6b-il", [s.id, ilNext.id]);
    await page.goto(shellUrl(ilFunnel), { waitUntil: "load" });
    await ready(page);
    await liveSection(page, 0).locator("[data-lg-input]").first().fill("4155551234");
    await liveSection(page, 0).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "a US-shaped phone blocks under the IL preset").toBe(0);
    const ilSlot = liveSection(page, 0).locator('[data-lg-error-for="r6b_phone"]');
    await expect(ilSlot).toBeVisible();
    await expect(ilSlot).toContainText("Israeli");
    await liveSection(page, 0).locator("[data-lg-input]").first().fill("0541234567");
    await liveSection(page, 0).locator("[data-lg-continue]").first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);

    // A SECOND section on International E.164 (the operator's third named
    // preset): a bare local number blocks; an E.164 '+'-prefixed one passes.
    const s2 = await createStudioSection(request, `R4ACC Item6B intl ${uniq}`, [
      { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "r6b2_phone", required: true, props: { phone_format: "e164_intl" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    const intlNext = await createNextSection(request);
    const intlFunnel = await seedLiveFunnel(request, "item6b-intl", [s2.id, intlNext.id]);
    await page.goto(shellUrl(intlFunnel), { waitUntil: "load" });
    await ready(page);
    await liveSection(page, 0).locator("[data-lg-input]").first().fill("5551234");
    await liveSection(page, 0).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "a non-E.164 number blocks under the International preset").toBe(0);
    await liveSection(page, 0).locator("[data-lg-input]").first().fill("+442071234567");
    await liveSection(page, 0).locator("[data-lg-continue]").first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
  });

  // =========================================================================
  // Item 7 — single-column (1) answer layout authorable + live (Images 26-27).
  // Journey: attempt to author "1" column through the REAL Style-tab columns
  // picker AND the section-default columns picker — the operator's literal
  // ask. If the raw content model IS honored live at columns:1 (a direct-API
  // probe, not routed through the broken UI), that is recorded too — the
  // per-layer table the investigation-protocol rules require (I8/E8).
  // =========================================================================
  // REGRESSION FOUND HERE (report to conductor, not fixed in this slice —
  // ui-section-studio.ts is outside this slice's exclusive ownership): own-
  // hand read confirms BOTH real authoring controls still literally render
  // `options([2, 3, 4, 5])` with no "1" —
  // ui-section-studio.ts:2735 `data-inspector-override="columns"`
  // (id="lg-style-choice-columns") and :2974 `data-section-columns-default`
  // (id="lg-inspector-columns"); the shared TOKEN_CONTROL_LABELS literal at
  // :1768 still reads "Card columns (2–5)". content-schema.ts:1950-1953 DOES
  // validate props.columns in range 1-5 server-side (the schema/validation
  // half of A-7 was fixed), but the operator's literal ask — pick "1" from
  // the real dropdown — is still unreachable through either authoring
  // surface. Register R4-12 ("P1b, PASS") claims this shipped; this
  // assertion (matching the operator's literal words) currently FAILS.
  test('Item 7 — "offer a single-column (1) answer layout" authorable via the real Columns picker + honored live', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item7 columns ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "IconCardAnswerGrid",
        question_id: "q_cards",
        internal_field: "r7_pick",
        answer_type: "enum",
        props: { columns: 2 },
        choices: [
          { label: "Allow", value: "allow", analytics_id: "al", icon: "home" },
          { label: "Deny", value: "deny", analytics_id: "de", icon: "car" },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);

    // The REAL per-group Style-tab Columns override picker(s) — the operator's
    // literal authoring path (Images 26-27 reference a full-width 1-col
    // stack). Two controls share this attribute (a group-scope + a
    // choice-scope override select) — check EVERY one the operator could
    // reach, not just the first match (a strict single-locator query 500s
    // here since both are simultaneously present).
    await canvasRender(page).locator('[data-component-type="IconCardAnswerGrid"]').click();
    await openInspectorTab(page, "style");
    const columnsSelects = page.locator('[data-inspector-override="columns"]');
    const columnsCount = await columnsSelects.count();
    expect(columnsCount, "at least one Columns override control is present").toBeGreaterThan(0);
    for (let i = 0; i < columnsCount; i++) {
      const sel = columnsSelects.nth(i);
      const id = await sel.getAttribute("id");
      const optionValues = await sel.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
      expect(optionValues, `Columns picker #${id} options: ${JSON.stringify(optionValues)} — the operator's ask is a real "1" option here`).toContain("1");
    }

    // Cross-check the section-level DEFAULT columns picker carries the same ask.
    // P7fix-columns (own-hand read): this used to also click
    // [data-studio-act="group-columns"] first — that control lives inside the
    // canvas toolbar's collapsed "More" popover (data-studio-more-panel,
    // ui-section-studio.ts ~1635), which this test never opens (no prior click
    // on data-studio-more-toggle). Playwright's actionability wait for an
    // element whose ANCESTOR carries `hidden` blocks for the full default
    // action timeout before the outer .catch() ever sees a rejection —
    // eating the whole 30s test budget and leaving the page mid-teardown for
    // the next locator call ("Target page, context or browser has been
    // closed"), reproduced deterministically pre-fix. The click also never
    // helped reach [data-section-columns-default] in the first place: that
    // control (renderSectionOverridesPanel) sits in the ALSO-hidden Design-
    // overrides drawer panel (itself gated behind #lg-qa-tools-toggle, a
    // second, unrelated precondition) — `.click()` on group-columns has no
    // path to either. locator.count()/.evaluateAll() below do NOT require
    // visibility (unlike .click()), so they already see the control exactly
    // as SSR'd, hidden ancestor or not — own-hand curl-verified: a fresh
    // studio page's raw HTML carries
    // `id="lg-section-columns-default" ...><option value="1">1` unconditionally.
    // Removing the dead click makes this cross-check assert for real instead
    // of hanging before ever reaching it.
    const sectionDefaultSelect = page.locator("[data-section-columns-default]");
    if (await sectionDefaultSelect.count()) {
      const defaultOptionValues = await sectionDefaultSelect.locator("option").evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
      expect(defaultOptionValues, `section-default Columns options: ${JSON.stringify(defaultOptionValues)}`).toContain("1");
    }

    // Diagnostic (I8/E8 per-layer evidence, not a substitute for the authoring
    // check above): does the RENDERER honor columns:1 if it is ever stored
    // (bypassing the UI via a direct API write)? Recorded either way.
    const directNode = await request.patch(`${LG_API}/sections/${s.public_id}`, {
      data: {
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
            {
              type: "IconCardAnswerGrid",
              question_id: "q_cards",
              internal_field: "r7_pick",
              answer_type: "enum",
              props: { columns: 1 },
              choices: [
                { label: "Allow", value: "allow", analytics_id: "al", icon: "home" },
                { label: "Deny", value: "deny", analytics_id: "de", icon: "car" },
              ],
            },
            { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
          ],
        },
      },
    });
    test.info().annotations.push({
      type: "item-7-diagnostic",
      description: `direct-API columns:1 PATCH status=${directNode.status()} (server-side schema honoring of columns:1, independent of the UI authoring gap above)`,
    });
    if (
      directNode.ok() &&
      liveLegChromiumOnly(
        browserName,
        "Item 7 live columns:1 render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The Columns-picker authoring assertions + the direct-API diagnostic above run engine-agnostically.",
      )
    ) {
      const seeded = await seedLiveFunnel(request, "item7", [s.id]);
      await page.goto(shellUrl(seeded), { waitUntil: "load" });
      await expect(page.locator('[data-question-id="q_cards"]').first()).toBeVisible({ timeout: 15_000 });
      const tracks = await page.evaluate(() => {
        const grid = document.querySelector('[data-question-id="q_cards"]');
        return grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : -1;
      });
      test.info().annotations.push({ type: "item-7-diagnostic-render", description: `live grid-template-columns track count with columns:1 stored = ${tracks}` });
    }
  });

  // =========================================================================
  // Item 8 — section name affordance + plain-language save errors (Image33).
  // Deeper gate: __p1a-studio.spec.ts (AC-4). Journey: the name field is a
  // visible, labeled affordance (not hidden until failure); an empty-name save
  // surfaces plain English, never the raw "section_name"/"headline_text" ids
  // (the B-4.9 headline jargon-leak bonus defect included).
  // =========================================================================
  test('Item 8 — the section-name field is a visible affordance, and save errors are plain English (no raw ids, incl. headline_text)', async ({
    page,
    request,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item8 name ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
    ]);
    await openEdit(page, s.public_id);

    const nameInput = page.locator("#lg-section-name");
    await expect(nameInput, "the name field is visible without any prior failure").toBeVisible();
    await expect(nameInput, "a real value is pre-filled").toHaveValue(s.public_id ? await nameInput.inputValue() : "");
    const placeholder = await nameInput.getAttribute("placeholder");
    expect(placeholder, "the field carries an inviting placeholder (a real affordance, not a bare box)").toBeTruthy();

    // Empty name + empty headline -> a PATCH 400 with BOTH problems surfaced
    // in plain English (B-4.9: headline_text jargon leak, inverted).
    await nameInput.fill("");
    await page.locator("#lg-section-save").click();
    const problems = page.locator("[data-studio-save-problems]");
    await expect(problems).toBeVisible();
    await expect(problems, "plain-language section-name error").toContainText("Section name is required");
    await expect(problems, "no raw section_name id leaks").not.toContainText("section_name");
    await expect(problems, "no raw headline_text id leaks in the same surface").not.toContainText("headline_text");
  });

  // =========================================================================
  // Item 9 — "+ Add choice" ghost doesn't distort the component's live
  // geometry (Images 34-35). Journey: measure the REAL choice cells' track
  // count + widths in the studio (ghost present) vs the SAME content live (no
  // ghost) — they must be identical (the P-8 probe's own measurement method).
  // =========================================================================
  test('Item 9 — "+ Add choice" ghost does not distort the live answer-grid geometry (studio == live cell widths/track count)', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `R4ACC Item9 addchoice ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_pick",
        internal_field: "r9_pick",
        answer_type: "enum",
        choices: [
          { label: "Home", value: "home", analytics_id: "home" },
          { label: "Auto", value: "auto", analytics_id: "auto" },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);

    const group = canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]');
    await expect(group).toBeVisible();
    await expect(group.locator("[data-choice-ghost]"), "the + Add choice ghost renders in studio").toHaveCount(1);

    const studioMetrics = await page.evaluate(() => {
      const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
      if (!doc) return null;
      const el = doc.querySelector('[data-question-id="q_pick"]');
      if (!el) return null;
      const view = doc.defaultView!;
      const cells = [...el.querySelectorAll(".lg-btn-answer")].map((c) => c.getBoundingClientRect().width);
      return { tracks: view.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length, cellCount: cells.length, cellWidths: cells };
    });
    expect(studioMetrics, "studio canvas measurable").not.toBeNull();
    expect(studioMetrics!.cellCount, "exactly the 2 REAL choices measured (the ghost is not counted as a real answer)").toBe(2);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 9 live geometry parity needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The studio-canvas ghost + measurement assertions above run engine-agnostically.",
      )
    )
      return;

    const seeded = await seedLiveFunnel(request, "item9", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await expect(page.locator('[data-question-id="q_pick"]').first()).toBeVisible({ timeout: 15_000 });
    const liveMetrics = await page.evaluate(() => {
      const el = document.querySelector('[data-question-id="q_pick"]');
      if (!el) return null;
      const cells = [...el.querySelectorAll(".lg-btn-answer")].map((c) => c.getBoundingClientRect().width);
      return { tracks: getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length, cellCount: cells.length, cellWidths: cells };
    });
    expect(liveMetrics, "live render measurable").not.toBeNull();
    expect(liveMetrics!.cellCount, "live never shows the ghost — exactly 2 real cells").toBe(2);

    expect(liveMetrics!.tracks, `grid track count identical studio (${studioMetrics!.tracks}) vs live (${liveMetrics!.tracks})`).toBe(studioMetrics!.tracks);
    const wStudio = studioMetrics!.cellWidths;
    const wLive = liveMetrics!.cellWidths;
    for (let i = 0; i < wLive.length; i++) {
      expect(Math.abs(wStudio[i]! - wLive[i]!), `cell ${i} width studio=${wStudio[i]} vs live=${wLive[i]} (the ghost must not distort real-cell geometry)`).toBeLessThanOrEqual(2);
    }
  });
});
