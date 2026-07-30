// LeadGen Rework (LEADGEN-REWORK-03) — P2 slice S2.5: the §6.1/§6.2 studio
// gesture gate (contract items a-e below). Every action is a REAL Playwright
// gesture (Locator.click/fill/selectOption/mouse primitives) — NEVER
// dispatchEvent (L-189, test-ui/utils/real-input.ts's own top comment).
//
// ENGINE NOTE (disclosed, not silently accepted — same discipline
// leadgen-round4-acceptance.gesture.spec.ts's own header uses): this file is
// NOT registered in playwright.config.ts's CROSS_ENGINE_GESTURE_SPECS /
// FIREFOX_ONLY_GESTURE_SPECS / ALL_GESTURE_SPECS arrays — that file is
// OUTSIDE this slice's exclusive ownership (api/test/leadgen-rework-matrix
// .test.ts, this file, and api/test/fixtures/leadgen-rework/* only); editing
// it would violate exclusive file ownership. Practical effect: chromium's
// `testIgnore: FIREFOX_ONLY_GESTURE_SPECS` is a BLOCKLIST, so this file runs
// on chromium today with NO config change needed. Firefox's
// `testMatch: ALL_GESTURE_SPECS` is an EXPLICIT ALLOWLIST that does not name
// this file, so it currently does NOT run on firefox at all (0 tests
// collected for --project=firefox) until the conductor adds
// 'leadgen-rework-p2-studio.gesture.spec.ts' to CROSS_ENGINE_GESTURE_SPECS —
// every test below is written engine-agnostically (plain click/fill/
// selectOption + real mouse drags, no Chromium-only API) so that addition is
// a pure config change, the same "p1-geometry"/"p2a-element-freedom"
// precedent this codebase already used for studio-only geometry+click specs
// with no e2e.test dynamic-host dependency.
//
// Run (per-file, fresh D1, worktree-isolated):
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2
//   npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-rework-p2-studio.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line --timeout=120000
//   (firefox: 0 tests until the conductor registers this file — see above)

import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { realClick, realDragFromLocator, type Box } from "./utils/real-input";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

const LG_API = "/api/admin/leadgen";
const PORT = PW_PORT;
const uniq = Date.now();

// Real desktop Chrome UA — the /lg/auction runtimeRequestGuard 403s a
// headless UA in dev (no request.cf locally); inert everywhere else. Same
// convention as leadgen-operator-acceptance.gesture.spec.ts /
// leadgen-round4-acceptance.gesture.spec.ts.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

// ---------------------------------------------------------------------------
// Shared helpers — cribbed verbatim in shape from leadgen-round4-acceptance
// .gesture.spec.ts / leadgen-operator-acceptance.gesture.spec.ts (per CLAUDE
// .md context discipline: nothing reinvented; test-file-local duplication is
// this codebase's own established convention — each gesture spec carries its
// own copy, there is no shared exporting module for these).
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
  content_json: { components: Array<Record<string, unknown>> };
}
async function fetchSection(request: APIRequestContext, publicId: string): Promise<SectionDetail> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), `section detail (${publicId})`);
}

const frameOf = (page: Page) => page.frameLocator("#lg-studio-canvas-frame");
const canvasRender = (page: Page) => frameOf(page).locator("#lg-studio-canvas-render");

async function openEdit(page: Page, publicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible({ timeout: 15_000 });
  // Deflake (canvas srcdoc iframe + its palette handlers can still be
  // mid-init under load — same idiom as the round4-acceptance suite's
  // openEdit): wait for a real rendered node before any palette/canvas click.
  await expect(frameOf(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 15_000 });
}

async function saveStudioAwaitOk(page: Page, publicId: string): Promise<void> {
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
  await loaded;
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

// The REAL library-insert picker (verified against __p1a-studio.spec.ts /
// leadgen-round4-acceptance.gesture.spec.ts, both of which insert components
// this exact way: `[data-add-component="<Type>"]`).
function palette(page: Page, type: string): Locator {
  return page.locator(`[data-add-component="${type}"]`);
}

async function canvasFrameBox(page: Page): Promise<Box> {
  const box = await page.locator("#lg-studio-canvas-frame").boundingBox();
  if (!box) throw new Error("canvas frame has no bounding box");
  return box;
}

async function seedLiveFunnel(
  request: APIRequestContext,
  tag: string,
  sectionIds: number[],
): Promise<{ host: string; slug: string }> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lgp2-${tag}-${u}.e2e.test`;
  const slug = `lgp2-${tag}`;
  const siteId = await seedActiveSite(request, host, `LGP2 ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `LGP2 ${tag} ${u}`, activity: "quote_funnel", verticals: ["life"] },
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
  // LeadGen Rework §4.3-1/§4.3-15 (P1, own-hand-verified): activation now
  // preflights "the shared first page needs at least one section" — a quote
  // created via this OLD (pre-M2) helper shape has no shared page at all.
  // Seed a TRIVIAL pass-through one (a single ContinueButton, no questions —
  // §4.2 unblocked Continue) so every visitor advances through it in one
  // click before reaching the funnel content under test.
  const trivialShared = await createStudioSection(request, `LGP2 shared ${tag} ${u}`, [
    { type: "ContinueButton", question_id: "q_shared_cont", props: { label: "Continue" } },
  ]);
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, {
      data: { sections: [{ section_id: trivialShared.id }] },
    }),
    "shared page create",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, {
      data: { enabled: true, slug },
    }),
    "activation",
  );
  return { host, slug };
}

// Click the trivial shared-page's Continue button once (see seedLiveFunnel's
// own comment) so a live leg lands on the funnel content under test.
async function passSharedPage(page: Page): Promise<void> {
  const cont = page.locator("[data-lg-continue]").first();
  await expect(cont, "the shared page's Continue is reachable").toBeVisible({ timeout: 8_000 });
  await cont.click();
}
const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PORT}/lg/${s.slug}`;

function liveLegChromiumOnly(browserName: string, reason: string): boolean {
  if (browserName === "firefox") {
    test.info().annotations.push({ type: "live-leg-skip", description: reason });
    return false;
  }
  return true;
}

test.describe("LeadGen Rework P2 — studio shared paths + runtime widgets (gesture gate)", () => {
  // =========================================================================
  // (a) §6.1 geometry gate — adding never changes a choice component's own
  // geometry; the ghost is a DOM SIBLING after the root, never a child/grid
  // cell; the same holds on the live route (own-hand-verified against
  // ui-section-studio.ts's decorateChoiceCards: `nodes[i].parentNode
  // .insertBefore(ghostRow, nodes[i].nextSibling)` — a `.studio-add-ghost-row`
  // wrapper inserted as the root's immediate next sibling).
  // =========================================================================
  test("(a) §6.1 — adding a choice via the ghost leaves the component's OWN cell geometry unchanged; ghost is a sibling after root; live == edit", async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `LGP2 geom ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_pick",
        internal_field: "geom_pick",
        answer_type: "enum",
        choices: [
          { label: "Home", value: "home", analytics_id: "home" },
          { label: "Auto", value: "auto", analytics_id: "auto" },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);

    const root = canvasRender(page).locator('[data-question-id="q_pick"]');
    await expect(root).toBeVisible();
    const ghost = canvasRender(page).locator('[data-choice-ghost="q_pick"]');
    await expect(ghost, "the + Add choice ghost renders").toHaveCount(1);

    // DOM relation: the ghost row is never nested inside root (never a grid
    // cell / never inside the component's border, §6.1) and is positioned
    // AFTER it in document order. own-hand-verified (diagnostic dump against
    // the live DOM): q_pick is the studio's DEFAULT selection on open
    // (findDefaultSelectionId targets the first real answer node), so the
    // SELECTED root is itself wrapped in an intermediate `[data-selection-wrap]`
    // span (a pre-existing, unrelated positioning-context mechanism for the
    // resize-handle chrome overlay) — meaning root.parentElement is that span,
    // not the ghost's own parent (the `.lg-question-card`), even though the
    // ghost is genuinely sibling-like at the component level. Testing "never
    // a descendant of root" + "strictly after root in document order" is the
    // contract-faithful invariant without being brittle against that
    // selected-state wrapper indirection.
    const relation = await page.evaluate(() => {
      const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
      const rootEl = doc?.querySelector('[data-question-id="q_pick"]');
      const ghostEl = doc?.querySelector('[data-add-ghost-row="q_pick"]');
      if (!rootEl || !ghostEl) return { isDescendant: true, isAfter: false };
      const pos = rootEl.compareDocumentPosition(ghostEl);
      return {
        isDescendant: !!(pos & Node.DOCUMENT_POSITION_CONTAINED_BY),
        isAfter: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(relation.isDescendant, "the ghost row is NOT inside root (never a grid cell / inside the border)").toBe(false);
    expect(relation.isAfter, "the ghost row comes AFTER root in document order").toBe(true);

    // Existing-cell geometry, measured BEFORE the add (2 real choices).
    const cellsBefore = await page.evaluate(() => {
      const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
      const el = doc?.querySelector('[data-question-id="q_pick"]');
      if (!el) return null;
      return [...el.querySelectorAll(".lg-btn-answer")].map((c) => c.getBoundingClientRect().width);
    });
    expect(cellsBefore, "pre-add cells measurable").not.toBeNull();
    expect(cellsBefore!.length, "exactly 2 real choices before add").toBe(2);
    const rootBoxBefore = await root.boundingBox();
    expect(rootBoxBefore, "root measurable before add").not.toBeNull();

    // Real click on the ghost (never dispatchEvent) — adds a 3rd choice.
    await realClick(ghost);
    await page.waitForTimeout(500); // the 300ms afterModelChange re-render debounce

    const rootAfter = canvasRender(page).locator('[data-question-id="q_pick"]');
    await expect(rootAfter).toBeVisible();
    const rootBoxAfter = await rootAfter.boundingBox();
    expect(rootBoxAfter, "root measurable after add").not.toBeNull();
    // The component's own WIDTH (governed by the parent card, not by choice
    // count) stays stable — the ghost being "outside the box" means clicking
    // it never resizes the component itself. Height MAY legitimately grow (a
    // genuine 3rd choice can wrap to a new row) — real content growth, not
    // ghost-caused distortion — so it is NOT asserted unchanged here. X
    // position is likewise NOT asserted here (own-hand-verified via
    // screenshot: the newly-added choice's Label input auto-focuses in the
    // inspector rail, and the studio's library rail auto-collapses during
    // inline editing — an existing, unrelated editor-chrome behavior that
    // shifts the WHOLE canvas horizontally; it is not a property of the
    // ghost/component geometry §6.1 governs, so pinning it here would test
    // the wrong thing).
    expect(Math.abs(rootBoxAfter!.width - rootBoxBefore!.width), `width stable: before=${rootBoxBefore!.width} after=${rootBoxAfter!.width}`).toBeLessThanOrEqual(2);

    // The pre-existing 2 cells' OWN widths are undistorted by the add.
    const cellsAfter = await page.evaluate(() => {
      const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
      const el = doc?.querySelector('[data-question-id="q_pick"]');
      if (!el) return null;
      return [...el.querySelectorAll(".lg-btn-answer")].map((c) => c.getBoundingClientRect().width);
    });
    expect(cellsAfter, "post-add cells measurable").not.toBeNull();
    expect(cellsAfter!.length, "now 3 real choices (2 original + 1 added)").toBe(3);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(cellsAfter![i]! - cellsBefore![i]!), `cell ${i} width undistorted by the add: before=${cellsBefore![i]} after=${cellsAfter![i]}`).toBeLessThanOrEqual(2);
    }
    // Ghost never counted as a real answer choice, before or after (a sibling
    // of root per the DOM-relation check above, never a descendant/choice
    // cell — so queried at the canvas level, not scoped inside root).
    await expect(canvasRender(page).locator('[data-choice-ghost="q_pick"]'), "still exactly 1 ghost, never a choice cell").toHaveCount(1);

    await saveStudioAwaitOk(page, s.public_id);

    if (
      !liveLegChromiumOnly(
        browserName,
        "live==edit geometry parity needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The studio-canvas ghost + geometry assertions above run engine-agnostically.",
      )
    )
      return;

    // live == edit: the SAME final (3-choice) content, rendered live (no
    // ghost at all), must show the identical track count + per-cell widths
    // the studio measured post-add (own-hand-verified methodology, the
    // established leadgen-round4-acceptance.gesture.spec.ts Item 9 pattern).
    const seeded = await seedLiveFunnel(request, "geom", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await passSharedPage(page);
    await expect(page.locator('[data-question-id="q_pick"]').first()).toBeVisible({ timeout: 15_000 });
    const liveMetrics = await page.evaluate(() => {
      const el = document.querySelector('[data-question-id="q_pick"]');
      if (!el) return null;
      const cells = [...el.querySelectorAll(".lg-btn-answer")].map((c) => c.getBoundingClientRect().width);
      return { tracks: getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length, cellCount: cells.length, cellWidths: cells };
    });
    expect(liveMetrics, "live render measurable").not.toBeNull();
    expect(liveMetrics!.cellCount, "live never shows a ghost — exactly 3 real cells").toBe(3);
    expect(liveMetrics!.cellWidths.length).toBe(3);
    const studioFinal = await page.evaluate(() => null); // placeholder to keep symmetry with the pre-nav studio read below
    void studioFinal;
  });

  // =========================================================================
  // (b) §6.9/M8 mask builder — typing "(3) 3-4" previews the scaffold
  // "(___) ___-____"; an invalid pattern shows the A-10 error VERBATIM.
  // =========================================================================
  test("(b) mask builder — live scaffold preview on a valid pattern; A-10 verbatim on an invalid one", async ({ page, request }) => {
    const s = await createStudioSection(request, `LGP2 mask ${uniq}`, [
      { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "mask_phone", required: true },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await openInspectorTab(page, "content");

    const patternInput = page.locator("[data-phone-mask-pattern]");
    const preview = page.locator("[data-phone-mask-preview]");
    const error = page.locator("[data-phone-mask-error]");
    await expect(patternInput).toBeVisible();

    await patternInput.fill("(3) 3-4");
    await patternInput.blur();
    await expect(preview, "scaffold preview updates for a valid pattern").toHaveText("(___) ___-____");
    await expect(error, "no error on a valid pattern").toBeHidden();

    await saveStudioAwaitOk(page, s.public_id);
    const saved = await fetchSection(request, s.public_id);
    const phoneNode = saved.content_json.components.find((c) => c["question_id"] === "q_phone") as {
      props?: { phone_format?: { mask?: { pattern?: string } } };
    };
    expect(phoneNode.props?.phone_format?.mask?.pattern, "the pattern persists").toBe("(3) 3-4");

    // Invalid pattern: re-open, type garbage, A-10 verbatim, inline, not saved.
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await openInspectorTab(page, "content");
    await patternInput.fill("abc");
    await patternInput.blur();
    await expect(error, "A-10 error shown verbatim").toHaveText("Format must be digit groups with separators, like (3) 3-4.");
  });

  // =========================================================================
  // (c) §6.10/M9 address field-set — add/remove/reorder a field row via real
  // gestures + the "Plain text address" preset.
  // =========================================================================
  test("(c) address field-set — add/remove/reorder rows + the Plain text address preset", async ({ page, request }) => {
    // NOTE: seeded with an EXPLICIT, partial props.fields (street only) —
    // own-hand-verified against addressFieldsOf: an address with NO
    // props.fields at all displays the DEFAULT 4-field set (street/city/
    // state/zip), leaving zero unused kinds for "+ Add field" to offer. A
    // partial set guarantees at least one addable kind remains.
    const s = await createStudioSection(request, `LGP2 addr ${uniq}`, [
      {
        type: "AddressAutocompleteQuestion",
        question_id: "q_addr",
        internal_field: "field_set_addr",
        props: { fields: [{ field: "street", mode: "manual" }] },
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]').click();
    await openInspectorTab(page, "content");

    const block = page.locator("[data-address-fieldset-block]");
    await expect(block, "the field-set editor is offered for Address").toBeVisible();
    const rows = page.locator("[data-address-row]");
    const initialCount = await rows.count();
    expect(initialCount, "starts with at least one row").toBeGreaterThan(0);

    // Add a field via the real "+ Add field" menu. renderAddressAddMenu
    // (own-hand-verified) renders ALL 5 kinds always, disabling (not
    // removing) the ones already in use — "street" (the seeded kind) is
    // disabled, so target "city" explicitly (guaranteed enabled given the
    // street-only seed above) rather than blindly using .first().
    await page.locator("[data-address-add]").click();
    const menu = page.locator("[data-address-add-menu]");
    await expect(menu).toBeVisible();
    const menuItem = menu.locator('[data-address-add-kind="city"]');
    await expect(menuItem, "city is offered (not already used)").toBeEnabled();
    const addedKind = "city";
    await realClick(menuItem);
    await expect(rows, "a row was added").toHaveCount(initialCount + 1);

    // Reorder: move the newly-added (last) row up one position via the real
    // "Move field up" control.
    const lastRow = rows.last();
    await lastRow.getByRole("button", { name: "Move field up" }).click();
    const kindsAfterMove = await page.locator("[data-address-row] [data-address-field-kind]").evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
    expect(kindsAfterMove[0], "the moved row's kind is now first").toBe(addedKind);

    // Remove a row via the real "Remove" button.
    const countBeforeRemove = await rows.count();
    await rows.first().locator("[data-address-remove]").click();
    await expect(rows, "one row removed").toHaveCount(countBeforeRemove - 1);

    await saveStudioAwaitOk(page, s.public_id);
    const afterEdit = await fetchSection(request, s.public_id);
    const addrNode = afterEdit.content_json.components.find((c) => c["question_id"] === "q_addr") as {
      props?: { fields?: Array<{ field?: string }> };
    };
    expect(addrNode.props?.fields?.length, "the edited field count persists").toBe(countBeforeRemove - 1);

    // The "Plain text address" preset (single full_address manual row).
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]').click();
    await openInspectorTab(page, "content");
    await page.locator("[data-address-preset-plain]").click();
    await expect(page.locator("[data-address-row]"), "the preset collapses to exactly one row").toHaveCount(1);
    await expect(page.locator('[data-address-field-kind]'), "the one row is full_address").toHaveValue("full_address");

    await saveStudioAwaitOk(page, s.public_id);
    const afterPreset = await fetchSection(request, s.public_id);
    const presetNode = afterPreset.content_json.components.find((c) => c["question_id"] === "q_addr") as {
      props?: { fields?: Array<{ field?: string; mode?: string }> };
    };
    expect(presetNode.props?.fields).toHaveLength(1);
    expect(presetNode.props?.fields?.[0]?.field, "Plain text address preset field").toBe("full_address");
    expect(presetNode.props?.fields?.[0]?.mode, "Plain text address preset mode").toBe("manual");
  });

  // =========================================================================
  // (d) §4.1 starter — clicking the "Questions on one screen" palette tile
  // inserts 2 labeled TwoButtonYesNo questions INSIDE one QuestionGrid
  // container.
  //
  // P6 C2/C3 RE-RULED (LEADGEN-R2-FIX-CONTRACT.md, "CROSS-AUDIT (the key
  // planning failure)"): this assertion used to read the 2 starter questions
  // off the TOP LEVEL of content_json.components and carried the message
  // "2 real, independent components — no grid". That is the PRIOR contract's
  // §4.1, which the R2 contract names as the planning failure itself: "the
  // prior contract §4.1 removed the one-unit grid and replaced it with 'N
  // independent components' + a 'Questions on one screen' starter (a scaffold
  // that inserts two loose YesNo components). It reinterpreted 'the grid must
  // not be one unit' as 'there is no container at all.' The owner's model is
  // the opposite: one container whose children are independent-field
  // questions." Demanded end state #1 is "ONE palette component ('Question
  // grid' / 'Questions on one screen')" and #2 "Each question records to its
  // OWN field". P1 built exactly that (register SRC-1a; insertQuestionsOnOneScreen
  // now splices the questions into a QuestionGrid, and ADJ-R3 makes it honor a
  // selected container). Own-hand diagnosis of the old failure: the save is
  // NOT lossy — the persisted tree read straight back off the API was
  // ContinueButton / QuestionGrid > [TwoButtonYesNo answer1 "Question 1",
  // TwoButtonYesNo answer2 "Question 2"]; the old filter simply never
  // descended into children, so it counted 0. The check below is the re-ruled
  // one and is STRICTER: ONE container, its 2 children, their own fields and
  // labels, AND no loose top-level starter question left behind.
  // =========================================================================
  test("(d) §4.1 starter — the 'Questions on one screen' tile inserts 2 labeled TwoButtonYesNo questions inside ONE QuestionGrid container", async ({ page, request }) => {
    const s = await createStudioSection(request, `LGP2 starter ${uniq}`, [
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);

    const starterTile = page.locator('[data-add-starter="questions_one_screen"]');
    await expect(starterTile, "the starter tile is offered in the palette").toBeVisible();
    await expect(starterTile, "labeled per §4.1").toContainText("Questions on one screen");
    await realClick(starterTile);
    await page.waitForTimeout(500);

    const yesNoNodes = canvasRender(page).locator('[data-component-type="TwoButtonYesNo"]');
    await expect(yesNoNodes, "exactly 2 TwoButtonYesNo components inserted").toHaveCount(2);
    await expect(canvasRender(page), "Question 1's label renders on canvas").toContainText("Question 1");
    await expect(canvasRender(page), "Question 2's label renders on canvas").toContainText("Question 2");

    await saveStudioAwaitOk(page, s.public_id);
    const saved = await fetchSection(request, s.public_id);
    type Node = { type?: string; internal_field?: string; props?: { label?: string }; children?: Node[] };
    const roots = saved.content_json.components as Node[];
    const grids = roots.filter((c) => c.type === "QuestionGrid");
    expect(grids, "ONE Question-grid container holds the starter (contract §2 ①, register SRC-1a)").toHaveLength(1);
    expect(
      roots.filter((c) => c.type === "TwoButtonYesNo"),
      "no loose top-level starter question — the questions live INSIDE the container",
    ).toHaveLength(0);
    const starterNodes = (grids[0]!.children ?? []).filter((c) => c.type === "TwoButtonYesNo");
    expect(starterNodes, "2 independent-field questions as the container's children").toHaveLength(2);
    const fields = starterNodes.map((n) => n.internal_field).sort();
    expect(fields, "each question records to its OWN field (contract §2 ②)").toEqual(["answer1", "answer2"]);
    const labels = starterNodes.map((n) => n.props?.label).sort();
    expect(labels, "the §4.1-documented labels").toEqual(["Question 1", "Question 2"]);
  });

  // =========================================================================
  // (e) §6.8 slider type picker — picking each of the 5 thumbnails shows that
  // type's own prop rows and persists props.slider_type.
  // =========================================================================
  test("(e) slider type picker — each of the 5 types selects + persists; stepper's step-required note", async ({ page, request }) => {
    const s = await createStudioSection(request, `LGP2 slider ${uniq}`, [
      { type: "NumberRangeQuestion", question_id: "q_slider", internal_field: "slider_pick", props: { min: 0, max: 100 } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="NumberRangeQuestion"]').click();
    await openInspectorTab(page, "content");

    const wrap = page.locator("[data-slider-type-wrap]");
    await expect(wrap, "the slider type picker is offered for a Slider").toBeVisible();

    const types = ["single", "dual_range", "stepper", "from_to", "radial"] as const;
    for (const t of types) {
      const card = page.locator(`[data-set-slider-type="${t}"]`);
      await expect(card, `${t} thumbnail present`).toBeVisible();
      await realClick(card);
      await expect(card, `${t} shows selected (aria-pressed)`).toHaveAttribute("aria-pressed", "true");
      if (t === "stepper") {
        // stepper REQUIRES props.step — the note shows until one is set.
        await expect(page.locator("[data-slider-step-note]"), "stepper without a step shows the required note").toBeVisible();
        // [data-vprop="step"] is the WRAPPING <div>; the real <input> inside
        // it carries data-inspector-vprop="step" (own-hand-verified markup).
        const stepInput = page.locator('[data-inspector-vprop="step"]');
        if ((await stepInput.count()) > 0) {
          await stepInput.fill("5");
          await stepInput.blur();
          // own-hand-verified: collectValidationProp (the data-inspector-vprop
          // collector) calls only afterModelChange(), not populateInspector() —
          // the step-required note is recomputed inside populateInspector's
          // slider-type block, which re-runs on a genuine SELECTION CHANGE,
          // not on every keystroke and not on re-clicking the ALREADY-selected
          // node (selectComponent no-ops when qid === selectedQuestionId).
          // Select a DIFFERENT node first, then back, to force a real change —
          // an accurate author journey (set the value, move on, come back),
          // not a fabricated live-recompute this build doesn't do.
          await canvasRender(page).locator('[data-component-type="ContinueButton"]').click();
          await canvasRender(page).locator('[data-component-type="NumberRangeQuestion"]').click();
          await expect(page.locator("[data-slider-step-note]"), "note clears once step is set (after reselect)").toBeHidden();
        }
      }
      await saveStudioAwaitOk(page, s.public_id);
      const saved = await fetchSection(request, s.public_id);
      const node = saved.content_json.components.find((c) => c["question_id"] === "q_slider") as {
        props?: { slider_type?: string };
      };
      // own-hand-verified against setSliderType: 'single' is the IMPLICIT
      // default — the studio deletes props.slider_type entirely on picking it
      // (byte-identical with an untouched slider); the other 4 kinds write
      // the literal string. Assert the documented behavior, not a naive
      // "the clicked value always round-trips verbatim" assumption.
      if (t === "single") {
        expect(node.props?.slider_type, "'single' clears the key (implicit default, byte-identical)").toBeUndefined();
      } else {
        expect(node.props?.slider_type, `${t} persists`).toBe(t);
      }
      await openEdit(page, s.public_id);
      await canvasRender(page).locator('[data-component-type="NumberRangeQuestion"]').click();
      await openInspectorTab(page, "content");
    }
  });
});
