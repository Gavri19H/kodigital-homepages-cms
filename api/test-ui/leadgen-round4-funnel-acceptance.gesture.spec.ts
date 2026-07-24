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

// M1 (§4.3-10) fork precondition, confirmed via source + live network trace
// (this investigation): forkVariantHandler's canBootstrapArm requires a
// RUNNING A/B test to ALREADY exist before a second active variant is
// sanctioned — quotes-handlers.ts's createAbTest own comment: "a fresh
// funnel's single active variant is already at bp=10000 (Σ trivially
// satisfied) — start immediately, then fork it to bootstrap a 2nd equal arm
// (§4.3-10)". Forking with NO test at all 409s "This funnel already has an
// active variant. A second active variant is only allowed as an arm of a
// running A/B test — set one up from the A/B tab." — so BOTH #lg-add-variant
// and #lg-theme-ab-this (funnel.ts's shared forkWithAllocation) require this
// precursor. Assumes the caller is ALREADY on the A/B tab (or navigates
// there itself afterward, since the reloads this triggers reset the active
// tab).
async function createAndStartExperiment(page: Page): Promise<void> {
  await page.locator('.lg-qtab[data-tab="ab"]').click();
  const createReq = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/experiments"));
  const createReload = page.waitForEvent("load");
  await page.locator("#lg-create-experiment").click();
  expect((await createReq).status(), "create A/B test").toBe(201);
  await createReload;

  await page.locator('.lg-qtab[data-tab="ab"]').click();
  const startBtn = page.locator("[data-start-experiment]");
  await expect(startBtn, "the newly-created draft test offers Start").toBeVisible();
  const startReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/experiments\/.+\/start$/.test(res.url()));
  const startReload = page.waitForEvent("load");
  await startBtn.click();
  expect((await startReq).status(), "start A/B test").toBe(200);
  await startReload;
  await page.locator('.lg-qtab[data-tab="ab"]').click();
}

// P5 rework (LEADGEN-REWORK-03 §4.3): every quote now carries a mandatory
// SHARED first page — activation 409s "activation.shared_page" until it
// carries ≥1 section. Only Item 10I (live theme-render leg) activates a
// quote onto a live site in this file; seed the SAME trivial single-
// ContinueButton shared page used across this phase's other live-funnel
// probes (__p5a-frame.spec.ts's seedTrivialSharedPage/passSharedPage
// precedent).
async function seedTrivialSharedPage(request: APIRequestContext, quotePublicId: string): Promise<void> {
  const shared = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `R4F shared ${Date.now()}${Math.floor(Math.random() * 1000)}`,
        activity: "quote_funnel", vertical: VERTICAL, status: "active",
        headline_text: "Continue", continue_mode: "button",
        content_json: JSON.stringify({ components: [{ type: "ContinueButton", question_id: "shared_cont", props: { label: "Continue" } }] }),
      },
    }),
    "r4f shared page section create",
  );
  await json(
    await request.post(`${LG_API}/quotes/${quotePublicId}/shared-page`, { data: { sections: [{ section_id: shared.id }] } }),
    "r4f shared page create",
  );
}
async function passSharedPage(page: Page): Promise<void> {
  await page.locator("[data-lg-continue]:visible").click();
}

function boxesIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

// NOTE: the OLD #lg-section-list-scoped <select>+button add pair is removed
// (§10/§8.9). The FUNNEL page's board "+ section" popover ([data-add-section])
// WAS a product bug (it opened then self-closed within the same synchronous
// click — the tabindex=0 control's focus scroll-into-view of the horizontally-
// scrolled board fired the global scroll->closeMenus). S5.3 root-caused and
// FIXED it (the open menu now REPOSITIONS on scroll instead of closing); proven
// live in test-ui/leadgen-rework-p3b-board.gesture.spec.ts ("S5.3 item 2 —
// funnel-page '+ section' popover stays open …"). Item 10J below still seeds its
// slots directly via the variant PUT because its proof intent — chip-name
// ellipsis/no-overlap — does not depend on HOW a slot was authored, not because
// the popover is broken.

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
  // REWRITTEN this sweep (§10/S5.1): the OLD narrow "#lg-structure-panel"
  // sidebar (a #lg-section-list-scoped <select>+button add-slot flow) was
  // superseded by the P3b funnel-builder BOARD (quotes-tabs/funnel.ts) — the
  // old ids/classes (#lg-structure-panel, #lg-add-page as an id,
  // .lg-studio-left, .lg-section-row, [data-select-slide], .lg-row-rail) are
  // confirmed gone (grep: 0 references in src/). The ellipsis + no-overlap
  // PROOF INTENT survives unchanged on the board's own section chip
  // (.lg-sec-chip .lg-sc-name carries the SAME text-overflow:ellipsis;
  // overflow:hidden;white-space:nowrap rule — quotes-tabs/shared.ts — inside
  // a flex row alongside .lg-chip-grip/.lg-chip-kebab, so overlap is
  // structurally prevented by the flex layout rather than fixed-width rail
  // math). The ~260px absolute-width claim itself does NOT survive: the
  // board's funnel columns are a fundamentally wider layout (multiple
  // funnels side by side, not a narrow management sidebar) — dropped rather
  // than pinned to an arbitrary new number with no contract citation.
  // =========================================================================
  test("Item 10J — long section names ellipsize cleanly inside the board's section chip; the name never overlaps the grip/kebab controls", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "10j");
    const longName = "A very long section headline that has to ellipsize inside the board's section chip without ever overlapping the grip or kebab controls";
    const s1 = await createSection(apiCtx, longName, `r4f10j_${Date.now()}`);

    // Seed the page (incl. the long-named section's slot) directly via the
    // variant PUT. Item 10J's proof intent is chip-name ellipsis/no-overlap,
    // which does not depend on HOW the slots were authored, so a direct PUT is
    // the terse setup. (The two authoring bugs this comment used to flag —
    // "+ Add page" 400ing on an empty page, and the funnel "+ section" popover
    // self-closing — were both root-caused and FIXED in S5.3 and are proven live
    // in leadgen-rework-p3b-board.gesture.spec.ts: "S5.3 item 1 — '+ Add page' …"
    // and "S5.3 item 2 — funnel-page '+ section' popover stays open …".)
    const filler = await createSection(apiCtx, `R4F 10j filler ${Date.now()}`, `r4f10jfill_${Date.now()}`);
    await json(
      await apiCtx.put(`${LG_API}/variants/${seed.variantPublicId}`, {
        data: {
          pages: [
            {
              name: "Page 1",
              slots: [
                { kind: "fixed", section_id: filler.public_id },
                { kind: "fixed", section_id: s1.public_id },
              ],
            },
          ],
        },
      }),
      "10j seed both slots",
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await openEditor(page, seed.quotePublicId);
    const funnelCol = page.locator(`[data-funnel-col][data-funnel-public-id="${seed.funnelPublicId}"]`);
    await expect(funnelCol).toBeVisible();

    const pageCard2 = funnelCol.locator("[data-page-card]").first();
    await expect(pageCard2.locator(".lg-sec-chip")).toHaveCount(2);
    const chip = pageCard2.locator(".lg-sec-chip", { hasText: longName.slice(0, 40) });
    await expect(chip).toBeVisible();
    const nameEl = chip.locator(".lg-sc-name");
    const kebab = chip.locator(".lg-chip-kebab");

    const ellipsis = await nameEl.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(ellipsis.scrollWidth, "the long name overflows its own cell (ellipsized, not wrapped)").toBeGreaterThan(ellipsis.clientWidth);
    const nameBox = await nameEl.boundingBox();
    const kebabBox = await kebab.boundingBox();
    expect(boxesIntersect(nameBox!, kebabBox!), "the ellipsized name must never overlap the kebab control").toBe(false);
    expect(s1.id, "section seeded").toBeTruthy();
  });

  // =========================================================================
  // Restructure item B / funnel delta B (D-3 FULL pages model)
  // [RETIRED this sweep, §10/S5.1 — coordinator-directed]: this test drove
  // the OLD #lg-section-list-scoped structure panel (#lg-structure-panel,
  // #lg-add-page/#lg-variant-save as ids, [data-page]/[data-slot]/
  // [data-slot-move-next]/[data-slot-kind-select]/[data-ruled-*]) — its
  // WHOLE client-side implementation (funnel.ts's `if (sectionList) {...}`
  // block: movePage/addSlotToPage/switchSlotKind/addRuledCase/addAbCand) is
  // CONFIRMED DEAD, not merely renamed: `sectionList = byId('lg-section-
  // list')`, and grep across src/ shows NO current render ever emits
  // `id="lg-section-list"` — the listener never attaches, so none of that
  // code is reachable from any admin page today.
  //
  // The P3b BOARD (quotes-tabs/funnel.ts, proven live in
  // leadgen-rework-p3b-board.gesture.spec.ts) is the CURRENT mechanism and
  // covers PART of this test's claims:
  //   - a page holds >=1 section (renderBoardPageCard iterates page.slots;
  //     addSectionToFunnelPage pushes additional slots onto the SAME page) —
  //     COVERED (Item 10J's rewrite above also exercises the add-section path).
  //   - page order is changeable — COVERED: the "page" kebab menu's
  //     page-up/page-down actions (data-menu-action, funnel.ts movePage) PUT
  //     the reordered `pages` array and reload; board-spec proves the
  //     sibling reorder affordances (chip-up/chip-down, funnel move-left/
  //     move-right) using the SAME kebab-menu pattern.
  //
  // Both of this test's remaining claims are now COVERED live by S5.3 (they
  // were open gaps when this test retired; the successor tests are in
  // test-ui/leadgen-rework-p3b-board.gesture.spec.ts + the §8.2 shared-chip
  // editor handler tests in test/leadgen-rework-handlers.test.ts):
  //   1. "move a section from page 1 -> page 2": chip-up/chip-down now ROLL OVER
  //      the page boundary within the funnel (moveFunnelChip, funnel.ts), and
  //      the cross-page MOVE drag has positive coverage too — "S5.3 item 4a —
  //      menu 'Move down' rolls a chip across the page boundary …" + "S5.3 item
  //      4b — dragging a chip from page 1 to page 2 …".
  //   2. "an in-page RULED slot (state=CA -> X, default Y)" AUTHORED via the UI:
  //      the shared-page chip menu's "A/B this slot" / "Slot rule" now open real
  //      in-board editors (funnel.ts renderSharedSlotAbDialog / RuledDialog — the
  //      old gotoTab('ab') dead-end stub is gone, U-09), and slot authoring lives
  //      in the §8.2 board's shared-chip editors. Proven by "S5.3 item 3 — author
  //      an A/B slot on the shared page via the chip menu …" + the handler tests
  //      "shared-page slot authoring (§8.2 shared-chip editors, S5.3)".
  // =========================================================================

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
    // The mandatory shared first page — must exist BEFORE activation or
    // computeReworkActivationProblems blocks with activation.shared_page.
    await seedTrivialSharedPage(apiCtx, seed.quotePublicId);
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
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 15_000 });
    // Click through the mandatory shared page (composed position 1 of 2) so
    // the funnel's own themed section becomes the active/shown page.
    await passSharedPage(page);
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
    // M1 (§4.3-10) fork precondition — see createAndStartExperiment's own
    // citation: "A/B this theme" (fork) 409s "This funnel already has an
    // active variant..." until a RUNNING A/B test already exists.
    await createAndStartExperiment(page);
    await page.locator('.lg-qtab[data-tab="themes"]').click();
    const select = page.locator("#lg-theme-preset-select");
    await expect(select.locator(`option[value="${themeB.item.id}"]`)).toHaveText(themeBName, { timeout: 10_000 });
    await select.selectOption(themeB.item.id);
    const forkReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/variants\/.+\/fork$/.test(res.url()));
    const putOriginalReq = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().endsWith(`/variants/${abSeed.variantPublicId}`));
    page.once("dialog", (dialog) => void dialog.accept("30"));
    await page.locator("#lg-theme-ab-this").click();
    const forkRes = await forkReq;
    expect(forkRes.status(), `fork response: ${await forkRes.text().catch(() => "(body unavailable)")}`).toBe(201);
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
    // [RETIRED §10/S5.1-era chrome]: the old fork-only affordance
    // (data-fork-variant, a document-level click listener in funnel.ts) has
    // no current renderer — grep confirms ab.ts (the A/B tab's HTML source)
    // never emits the attribute; the listener is orphaned dead code. The
    // CURRENT mechanism is #lg-add-variant (confirmed visible above), which
    // this SAME test already exercises end-to-end below (POST .../fork +
    // the allocation PUT + the new arm's honest "Same as control" label) —
    // so removing this one stale visibility check drops no proof coverage.
    await expect(page.locator("[data-alloc-sum]"), "the allocation editor is present").toBeVisible();
    // [data-arm-variance] -> [data-arm-varies] + "Control"/"Same as control
    // (no differences yet)" -> "Base variant"/"No layout or template changes
    // yet": ab.ts's own header comment states the decision explicitly —
    // "Rework M1 (§4.3-10): NO control concept... All '(control)'/'Differs
    // from control'/'Same as control' copy is REMOVED (plain variant labels
    // + what each arm overrides)". Confirmed via grep: data-arm-variance is
    // never rendered anywhere in src/; data-arm-varies (renderAbPanel's
    // variantVariesLine) is the CURRENT, live per-arm summary — same honest-
    // labeling proof intent (never invents a difference), current vocabulary.
    await expect(page.locator(`[data-arm-varies="${seed.variantPublicId}"]`), "the base (first) variant is labeled honestly, no retired control vocabulary").toHaveText("Base variant");

    // M1 (§4.3-10) fork precondition — see createAndStartExperiment's own
    // citation: Add-variant (fork) 409s "This funnel already has an active
    // variant..." until a RUNNING A/B test already exists on this funnel.
    await createAndStartExperiment(page);

    const forkReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/variants\/.+\/fork$/.test(res.url()));
    const putOriginalReq = page.waitForResponse((res) => res.request().method() === "PUT" && res.url().endsWith(`/variants/${seed.variantPublicId}`));
    const reloadedEvt = page.waitForEvent("load");
    page.once("dialog", (dialog) => void dialog.accept("25"));
    await page.locator("#lg-add-variant").click();
    const forkRes = await forkReq;
    expect(forkRes.status(), `fork response: ${await forkRes.text().catch(() => "(body unavailable)")}`).toBe(201);
    const forkBody = (await forkRes.json()) as { public_id: string };
    await putOriginalReq;
    await reloadedEvt;
    await page.locator('.lg-qtab[data-tab="ab"]').click();

    const newRow = page.locator(`[data-variant="${forkBody.public_id}"]`);
    await expect(newRow, "the new arm appears in the A/B tab").toBeVisible();
    await expect(newRow.locator("[data-arm-varies]"), "a plain fork is honestly labeled — no differences invented, current vocabulary").toHaveText("No layout or template changes yet");
  });
});
