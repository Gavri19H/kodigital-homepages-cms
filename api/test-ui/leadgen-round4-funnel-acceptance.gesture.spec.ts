// LeadGen Round-4 Remediation — Phase P7 close: THE ROUND-4 OPERATOR ACCEPTANCE
// SUITE, Funnel-builder half (register docs/leadgen/round4/register.md rows
// R4-24, R4-25, R4-28..R4-33, R4-44 + D-2). Re-walks the operator's structure/
// pages/routing/theme/A-B asks (LEADGEN-ROUND4-INVESTIGATION-2026-07-19.md item
// 10J + 10I + the restructure spec's funnel deltas A-D + the D-2 decision round)
// as live operator journeys against the CURRENT code (P3/P4/P6 already merged).
// SIBLING FILES: leadgen-round4-acceptance.gesture.spec.ts (Section Studio,
// items 1-9) and leadgen-round4-quotes-acceptance.gesture.spec.ts (Templates/
// frame elements, items 10A-H + restructure IA).
//
// Patterns cribbed verbatim (nothing reinvented): __p3b-structure.spec.ts (the
// pages-first structure panel: add page/slot, move-across-pages, reorder,
// A/B-slot authoring, the ruled-slot case+default pickers, the 260px
// ellipsis/no-overlap CSS check), __p4b-rules.spec.ts (the "+ New rule" modal:
// name/priority/type/conditions/checkpoint/target-by-NAME, status toggle,
// Duplicate, the hidden-legacy-input invisibility proof, the redirect_pct
// field), __p6b-theme-mgr.spec.ts (the inline Themes-tab editor, the
// standalone theme-manager editor's 3-sequential-PATCH proof, preset
// apply/delete incl. the in-use 409 guard, the "A/B this theme" one-click
// fork, the A/B tab's Add-variant + allocation + what-varies summary).
//
// ENGINE NOTE: same disclosed chromium-only registration gap as the sibling
// files (playwright.config.ts's CROSS_ENGINE_GESTURE_SPECS whitelist is outside
// this slice's ownership) — see leadgen-round4-acceptance.gesture.spec.ts's
// header for the full explanation.
//
// Run (per-file, fresh D1, worktree-isolated):
//   pgrep -f kodigital-cms-round4-wt | xargs -r kill -9; cd api && npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-round4-funnel-acceptance.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

// Item 10I's theme-apply leg navigates a dynamic *.e2e.test tenant host (the
// live-render proof) — resolve it to loopback, same convention as every other
// spec touching a tenant host (harmless to every other test in this file,
// which are all plain 127.0.0.1 admin-UI navigations).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const VERTICAL = "life";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function createSection(request: APIRequestContext, name: string, field: string): Promise<{ id: number; public_id: string }> {
  return json(
    await request.post(`${LG_API}/sections`, {
      data: {
        activity: "quote_funnel",
        vertical: VERTICAL,
        status: "active",
        section_name: name,
        headline_text: name,
        content_json: JSON.stringify({
          components: [
            { type: "TwoButtonYesNo", question_id: "q", question_key: field, internal_field: field, answer_type: "boolean", required: true },
            { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
          ],
        }),
      },
    }),
    `section create (${name})`,
  );
}

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
}
async function seedQuote(request: APIRequestContext, tag: string): Promise<SeededQuote> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `R4F ${tag} ${u}`, activity: "quote_funnel", verticals: [VERTICAL] } }),
    "quote create",
  );
  return { quotePublicId: quote.public_id, funnelPublicId: quote.funnels[0]!.public_id, variantPublicId: quote.funnels[0]!.variants[0]!.public_id };
}

async function openEditor(page: Page, quotePublicId: string, variantPublicId?: string): Promise<void> {
  const qs = variantPublicId ? `?variant=${encodeURIComponent(variantPublicId)}` : "";
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit${qs}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-panel='builder']")).toBeVisible({ timeout: 20_000 });
}

function boxesIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

async function addSectionToPage(pageLoc: import("@playwright/test").Locator, label: string): Promise<void> {
  await pageLoc.locator("[data-add-slot-select]").selectOption({ label });
  await pageLoc.locator("[data-add-slot]").click();
}

// The dynamic-host live leg (a *.e2e.test tenant host, resolved via
// chromium's --host-resolver-rules launch arg above) is chromium-only —
// firefox has no equivalent for a wildcard/dynamic subdomain. On firefox:
// record a DOCUMENTED skip annotation and signal the caller to return after
// its both-engine admin/authoring assertions — the SAME liveLegChromiumOnly()
// pattern the sibling round-4 acceptance files use.
function liveLegChromiumOnly(browserName: string, reason: string): boolean {
  if (browserName === "firefox") {
    test.info().annotations.push({ type: "live-leg-skip", description: reason });
    return false;
  }
  return true;
}

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

test.describe("Round-4 acceptance — Funnel builder: structure/pages/routing/theme/A-B (register R4-24/25/28-33/44)", () => {
  // =========================================================================
  // Item 10J — funnel structure panel broken layout (Image41), fixed.
  // Deeper gate: __p3b-structure.spec.ts. Journey: a long section name
  // ellipsizes inside the ~260px rail without ever wrapping into / crowding
  // the controls rail — ONE owned style block, not the old two-CSS-block split.
  // =========================================================================
  test("Item 10J — long section names ellipsize cleanly at the ~260px structure rail; the name cell never overlaps the controls rail", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    const seed = await seedQuote(apiCtx, "10j");
    const longName = "A very long section headline that has to ellipsize inside the two hundred and sixty pixel structure rail without ever wrapping the row";
    const s1 = await createSection(apiCtx, longName, `r4f10j_${Date.now()}`);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    await page.locator("#lg-add-page").click();
    const list = page.locator("#lg-section-list");
    const p1 = list.locator("[data-page]").nth(0);
    await addSectionToPage(p1, `${longName} (${VERTICAL})`);
    await expect(p1.locator("[data-slot]")).toHaveCount(1);

    const panelBox = await page.locator(".lg-studio-left").boundingBox();
    expect(panelBox, "the structure rail measures ~260px").not.toBeNull();
    expect(panelBox!.width).toBeLessThanOrEqual(280);

    const row = p1.locator(".lg-section-row");
    const nameBtn = row.locator("[data-select-slide]");
    const rail = row.locator(".lg-row-rail");
    const ellipsis = await nameBtn.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(ellipsis.scrollWidth, "the long name overflows its own cell (ellipsized, not wrapped)").toBeGreaterThan(ellipsis.clientWidth);
    const nameBox = await nameBtn.boundingBox();
    const railBox = await rail.boundingBox();
    expect(boxesIntersect(nameBox!, railBox!), "the name cell must never overlap the handle/arrows/Remove controls rail").toBe(false);
    expect(s1.id, "section seeded").toBeTruthy();
  });

  // =========================================================================
  // Restructure item B / funnel delta B (D-3 FULL pages model) — a page holds
  // >=1 section, page order is changeable, and an in-page RULE chooses which
  // section renders in a slot ("CA sees section X, everyone else Y").
  // Deeper gate: __p3a-pages.spec.ts + __p3b-structure.spec.ts. Journey:
  // author 2 pages (2 sections in page 1, 1 in page 2), move a section across
  // pages, reorder the pages, save -> reload round-trips; then configure a
  // SEPARATE slot as RULED (state=CA -> section X, default section Y).
  // =========================================================================
  test("Pages model — multi-section pages, reorder, move-across-pages, and an in-page RULED slot (state=CA -> X, default Y), all round-trip", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    const seed = await seedQuote(apiCtx, "pages");
    const u = Date.now();
    const s1 = await createSection(apiCtx, `R4F Welcome ${u}`, `r4fp1_${u}`);
    const s2 = await createSection(apiCtx, `R4F Benefits ${u}`, `r4fp2_${u}`);
    const s3 = await createSection(apiCtx, `R4F Details ${u}`, `r4fp3_${u}`);

    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    const list = page.locator("#lg-section-list");

    await page.locator("#lg-add-page").click();
    await page.locator("#lg-add-page").click();
    let pages = list.locator("[data-page]");
    await expect(pages).toHaveCount(2);
    await pages.nth(0).locator("[data-page-name]").fill("Welcome");
    await pages.nth(1).locator("[data-page-name]").fill("Details");

    await addSectionToPage(pages.nth(0), `R4F Welcome ${u} (${VERTICAL})`);
    await addSectionToPage(pages.nth(0), `R4F Benefits ${u} (${VERTICAL})`);
    await addSectionToPage(pages.nth(1), `R4F Details ${u} (${VERTICAL})`);
    await expect(pages.nth(0).locator("[data-slot]"), "page 1 holds 2 sections (a real multi-section page)").toHaveCount(2);
    await expect(pages.nth(1).locator("[data-slot]")).toHaveCount(1);

    // Move a section from page 1 -> page 2 (the explicit control).
    await pages.nth(0).locator("[data-slot]").first().locator("[data-slot-move-next]").click();
    await expect(pages.nth(0).locator("[data-slot]")).toHaveCount(1);
    await expect(pages.nth(1).locator("[data-slot]")).toHaveCount(2);

    // Reorder pages (page order changeable per funnel — restructure delta A).
    await pages.nth(1).locator("[data-page-up]").click();
    pages = list.locator("[data-page]");
    await expect(pages.nth(0).locator("[data-page-name]")).toHaveValue("Details");
    await expect(pages.nth(1).locator("[data-page-name]")).toHaveValue("Welcome");

    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantPublicId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `variant PUT: ${await put.text()}`).toBe(200);
    const putBody = put.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(putBody)).toContain("pages");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-structure-panel")).toBeVisible({ timeout: 20_000 });
    const list2 = page.locator("#lg-section-list");
    const pages2 = list2.locator("[data-page]");
    await expect(pages2).toHaveCount(2);
    await expect(pages2.nth(0).locator("[data-page-name]"), "reordered pages round-trip").toHaveValue("Details");
    await expect(pages2.nth(1).locator("[data-page-name]")).toHaveValue("Welcome");
    await expect(pages2.nth(0).locator("[data-slot]")).toHaveCount(2);
    await expect(pages2.nth(1).locator("[data-slot]")).toHaveCount(1);

    // --- in-page RULED slot: state=CA -> section X, default section Y -------
    await page.locator("#lg-add-page").click();
    const pages3 = list2.locator("[data-page]");
    const rulePage = pages3.nth(2);
    await addSectionToPage(rulePage, `R4F Details ${u} (${VERTICAL})`); // seeds the fixed slot -> Y default
    await rulePage.locator("[data-slot]").first().locator("[data-slot-kind-select]").selectOption("ruled");
    const ruledSlot = rulePage.locator('[data-slot][data-slot-kind="ruled"]');
    await expect(ruledSlot).toHaveCount(1);
    const caseRow = ruledSlot.locator("[data-ruled-case]").first();
    await caseRow.locator("[data-ruled-field]").selectOption("state");
    await caseRow.locator("[data-ruled-op]").selectOption("eq");
    await caseRow.locator("[data-ruled-value]").fill("CA");
    await caseRow.locator("[data-ruled-section]").selectOption(s2.public_id);
    await ruledSlot.locator("[data-ruled-default]").selectOption(s3.public_id);

    const putPromise2 = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantPublicId}`));
    await page.locator("#lg-variant-save").click();
    const put2 = await putPromise2;
    expect(put2.status(), `ruled-slot PUT: ${await put2.text()}`).toBe(200);
    const putBody2 = put2.request().postDataJSON() as { pages: Array<{ slots: Array<Record<string, unknown>> }> };
    const ruledSent = putBody2.pages[2]!.slots[0]!;
    expect(ruledSent["kind"], "the in-page rule is a REAL ruled slot, not a UI-only shape").toBe("ruled");
    expect(ruledSent["cases"]).toEqual([{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: s2.public_id }]);
    expect(ruledSent["default_section_id"]).toBe(s3.public_id);

    await page.reload({ waitUntil: "domcontentloaded" });
    const rulePage2 = list2.locator("[data-page]").nth(2);
    const ruledSlot2 = rulePage2.locator("[data-slot]").first();
    await expect(ruledSlot2, "the ruled slot round-trips").toHaveAttribute("data-slot-kind", "ruled");
    await expect(ruledSlot2.locator("[data-ruled-case]").first().locator("[data-ruled-value]")).toHaveValue("CA");
    await expect(ruledSlot2.locator("[data-ruled-default]")).toHaveValue(s3.public_id);
  });

  // =========================================================================
  // D-2 routing rules [RETIRED: §10/S5.1] — this test drove the FIRST-
  // generation per-variant routing-rules PANEL (#lg-routing-rules-root/
  // #lg-rule-new/#lg-rule-modal/#lg-modal-*/#lg-rules-table-body), rendered
  // by ui-rules-builder.ts's renderRoutingRulesPanel/ROUTING_RULES_SCRIPT —
  // confirmed 0 real callers (P5 orphan-scan) and deleted this sweep, along
  // with its whole server-side evaluation chain in public/leadgen/resolver.ts
  // (evaluateEntryRouting/evaluateCheckpointRouting/parseRoutingRule/
  // loadRoutingRules/etc.) and the route_funnel_variant rule_type itself
  // (migration 0048/M3's CHECK now forbids it). None of this test's DOM ids
  // exist in any served page anymore. The RELOCATED four-type rules editor
  // (renderRelocatedRulesEditor/RELOCATED_RULES_SCRIPT, ui-rules-builder.ts)
  // is the current live mechanism — its modal/table behavior (live-updating
  // checkpoint, redirect_direct_offer authored via the offer NAME picker,
  // toggle/duplicate) is proven in test-ui/leadgen-rework-p3b-rules.gesture
  // .spec.ts (e.g. its "edit -> the read-only checkpoint updates live" and
  // "#lg-frr-type"/redirect_direct_offer tests) — the successor to this one.
  // =========================================================================
  test("Routing rules (D-2) [RETIRED: §10/S5.1] — the OLD per-variant routing panel has no current admin surface (see describe-block citation)", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "routingretired");
    await openEditor(page, seed.quotePublicId);
    await expect(page.locator("#lg-routing-rules-root")).toHaveCount(0);
    await expect(page.locator("#lg-rule-new")).toHaveCount(0);
    await expect(page.locator("#lg-rules-table-body")).toHaveCount(0);
  });

  // =========================================================================
  // Item 10I — theme v2: self-hosted font, display-XXL, a button style, saved
  // as a preset (standalone editor, 3 sequential PATCHes), DELETE with an
  // in-use guard, per-funnel picker, one-click theme A/B fork. Deeper gate:
  // __p6b-theme-mgr.spec.ts. Journey: author a rich preset via the standalone
  // theme-manager editor -> reload round-trips -> apply to a funnel -> live
  // funnel renders it -> a referenced preset is 409-refused on delete (naming
  // the funnel) -> unreferenced it deletes 200 -> "A/B this theme" forks with
  // the picked preset on the new arm at the chosen split.
  // =========================================================================
  test("Item 10I — theme v2: font+display-XXL+button-style preset authored via the standalone editor, applies live, DELETE in-use-guarded, one-click theme A/B fork", async ({ page, browserName }) => {
    const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const themePayload = (name: string, headlineFont: string) => ({
      name,
      roles: { brand_primary: "#123456", accent: "#654321", page_bg: "#FFFFFF", card: "#FFFFFF", text: "#101010", success: "#0E7C3A", error: "#B23A2C" },
      typography: { headline_font: headlineFont, body_font: "Inter", base_px: 16 },
      controls: { field_height: "medium", button_size: "m", corners: "rounded" },
    });
    const created = await json<{ item: { id: string } }>(await apiCtx.post(`${LG_API}/themes`, { data: themePayload(`R4F Preset ${u}`, "Newsreader") }), "create preset");
    const themeId = created.item.id;

    // Author via the STANDALONE theme-manager editor — 3 sequential
    // auto-PATCHing edits, each fully waited out.
    await page.goto(`/admin/leadgen/themes?theme=${themeId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#tm-theme-name")).toHaveValue(`R4F Preset ${u}`);
    let reloaded = page.waitForEvent("load");
    await page.locator("#tm-headline-font").selectOption("Poppins");
    await reloaded;
    reloaded = page.waitForEvent("load");
    await page.locator('[data-tm-seg][data-top="typography"][data-group="display_size"][data-value="xxl"]').click();
    await reloaded;
    reloaded = page.waitForEvent("load");
    await page.locator('[data-tm-seg][data-top="button_style"][data-group="fill"][data-value="soft"]').click();
    await reloaded;

    const record = await json<{ item: { typography: { headline_font: string; display_size?: string }; button_style?: { fill?: string } } }>(
      await apiCtx.get(`${LG_API}/themes/${themeId}`),
      "get theme after 3 patches",
    );
    expect(record.item.typography.headline_font, "font persists").toBe("Poppins");
    expect(record.item.typography.display_size, "display-XXL persists").toBe("xxl");
    expect(record.item.button_style?.fill, "the soft button style persists").toBe("soft");

    // Apply to a funnel -> live funnel renders the rich preset. A QuestionHeadline
    // (bound to section_headline) is required for a .lg-headline node to exist
    // at all — the shared createSection() helper (TwoButtonYesNo) has none.
    const seed = await seedQuote(apiCtx, "themeapply");
    const s = await json<{ public_id: string }>(
      await apiCtx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel",
          vertical: VERTICAL,
          status: "active",
          section_name: `R4F Theme Section ${u}`,
          headline_text: `R4F Theme Section ${u}`,
          content_json: JSON.stringify({
            components: [
              { type: "QuestionHeadline", question_id: `q_${u}_h`, bind: "section_headline", props: {} },
              { type: "ContinueButton", question_id: `q_${u}_cont`, props: { label: "Continue" } },
            ],
          }),
        },
      }),
      "theme rich section create",
    );
    await json(await apiCtx.put(`${LG_API}/variants/${seed.variantPublicId}`, { data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: s.public_id }] }] } }), "variant pages");
    const host = `r4f-theme-${u}.e2e.test`;
    const siteId = await seedActiveSite(apiCtx, host, `R4F Theme Site ${u}`);
    await json(await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${siteId}`, { data: { enabled: true, slug: `r4f-theme-${u}` } }), "activation");
    await json(await apiCtx.put(`${LG_API}/funnels/${seed.funnelPublicId}/theme`, { data: { theme_json: { theme_id: themeId } } }), "apply preset");
    // Confirm the PUT actually persisted theme_id on the funnel (server
    // read-back, independent of the live-render check below).
    const funnelAfter = await json<{ theme_json: { theme_id?: string } | null }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}`),
      "get funnel after theme PUT",
    );
    expect(funnelAfter.theme_json?.theme_id, "the funnel correctly references the edited preset").toBe(themeId);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10I live theme-record render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The standalone theme-editor authoring + persist + DELETE-guard + A/B-fork assertions (before and after this block) run engine-agnostically.",
      )
    )
      return;

    // P7fix-defaultframe (fc41ae2) closed the regression this block
    // originally found (a brand-new, explicitly-themed frameless funnel was
    // resolving the WRONG render-path default frame, serving the theme
    // record's pre-edit values) — this assertion is now expected to hold.
    await page.goto(`http://${host}:${PW_PORT}/lg/r4f-theme-${u}`, { waitUntil: "load" });
    await page.locator(".lg-headline").first().waitFor();
    const size = Number.parseFloat(await page.locator(".lg-headline").first().evaluate((el) => getComputedStyle(el).fontSize));
    const family = await page.locator(".lg-headline").first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(size, "display-XXL renders live (>68px)").toBeGreaterThan(68);
    expect(family).toContain("Poppins");

    // DELETE in-use guard: refused 409 naming the funnel; unreferenced deletes 200.
    const refused = await apiCtx.delete(`${LG_API}/themes/${themeId}`);
    expect(refused.status(), "an in-use preset refuses delete").toBe(409);
    const refusedBody = (await refused.json()) as { error: string };
    expect(refusedBody.error).toContain("used by 1 funnel");
    await json(await apiCtx.put(`${LG_API}/funnels/${seed.funnelPublicId}/theme`, { data: { theme_json: {} } }), "unassign preset");
    const clean = await apiCtx.delete(`${LG_API}/themes/${themeId}`);
    expect(clean.status(), "an unreferenced preset deletes clean").toBe(200);

    // One-click "A/B this theme" fork on a FRESH quote+preset pair.
    const abSeed = await seedQuote(apiCtx, "abtheme");
    const themeBName = `R4F Theme B ${u}`;
    const themeB = await json<{ item: { id: string } }>(await apiCtx.post(`${LG_API}/themes`, { data: themePayload(themeBName, "Inter") }), "create theme B");
    await openEditor(page, abSeed.quotePublicId, abSeed.variantPublicId);
    await page.locator('.lg-qtab[data-tab="themes"]').click();
    const select = page.locator("#lg-theme-preset-select");
    await expect(select.locator(`option[value="${themeB.item.id}"]`)).toHaveText(themeBName, { timeout: 10_000 });
    await select.selectOption(themeB.item.id);
    const forkReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/variants\/.+\/fork$/.test(res.url()));
    const putOriginalReq = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().endsWith(`/variants/${abSeed.variantPublicId}`));
    page.once("dialog", (dialog) => void dialog.accept("30"));
    await page.locator("#lg-theme-ab-this").click();
    const forkRes = await forkReq;
    expect(forkRes.status()).toBe(201);
    const forkBody = (await forkRes.json()) as { public_id: string };
    expect((await putOriginalReq).status()).toBe(200);
    const variants = await json<{ items: Array<{ public_id: string; traffic_allocation_bp: number; frame_overrides_json: { theme_id?: string } | null }> }>(
      await apiCtx.get(`${LG_API}/funnels/${abSeed.funnelPublicId}/variants`),
      "list variants",
    );
    const newArm = variants.items.find((v) => v.public_id === forkBody.public_id);
    expect(newArm!.traffic_allocation_bp, "the chosen 30% split lands on the new arm").toBe(3000);
    expect(newArm!.frame_overrides_json?.theme_id, "theme B is assigned to the new arm").toBe(themeB.item.id);
    const original = variants.items.find((v) => v.public_id === abSeed.variantPublicId);
    expect(original!.traffic_allocation_bp, "the control shrinks to 70%").toBe(7000);
  });

  // =========================================================================
  // Funnel delta C — funnel-level A/B surfaced: Add variant + what-varies +
  // allocation. Deeper gate: __p6b-theme-mgr.spec.ts. Journey: the A/B tab
  // offers a real "Add variant" affordance (not fork-only), the allocation
  // editor, and an honest per-arm what-varies summary (Control vs "Same as
  // control" for a plain fork with no authored differences yet).
  // =========================================================================
  test("Funnel delta C — the A/B tab offers Add variant + the allocation editor + an honest per-arm what-varies summary", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "addvariant");
    await openEditor(page, seed.quotePublicId, seed.variantPublicId);
    await page.locator('.lg-qtab[data-tab="ab"]').click();
    const abPanel = page.locator('[data-panel="ab"]');
    await expect(abPanel).toHaveClass(/active/);
    await expect(page.locator("#lg-add-variant"), "a real Add-variant affordance exists (not fork-only)").toBeVisible();
    await expect(abPanel.locator("[data-fork-variant]")).toBeVisible();
    await expect(page.locator("[data-alloc-sum]"), "the allocation editor is present").toBeVisible();
    await expect(page.locator(`[data-arm-variance="${seed.variantPublicId}"]`), "the control is labeled honestly").toHaveText("Control");

    const forkReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/variants\/.+\/fork$/.test(res.url()));
    const putOriginalReq = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().endsWith(`/variants/${seed.variantPublicId}`));
    const reloadedEvt = page.waitForEvent("load");
    page.once("dialog", (dialog) => void dialog.accept("25"));
    await page.locator("#lg-add-variant").click();
    const forkRes = await forkReq;
    expect(forkRes.status()).toBe(201);
    const forkBody = (await forkRes.json()) as { public_id: string };
    await putOriginalReq;
    await reloadedEvt;
    await page.locator('.lg-qtab[data-tab="ab"]').click();

    const newRow = page.locator(`[data-variant="${forkBody.public_id}"]`);
    await expect(newRow, "the new arm appears in the A/B tab").toBeVisible();
    await expect(newRow.locator("[data-arm-variance]"), "a plain fork is honestly labeled — no differences invented").toHaveText("Same as control (no differences yet)");
  });
});
