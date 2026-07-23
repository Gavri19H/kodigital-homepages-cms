// LeadGen Round-4 Remediation — Phase P1 slice P1b probe spec (temporary; final
// consolidation lands in P7). Drives the REAL Section Studio + the REAL
// /sections/preview producer with REAL input (locator.click / fill /
// selectOption — ZERO dispatchEvent), asserting this slice's rendering
// deliverables end-to-end:
//   AC-1  the "+ Add choice" ghost is OUT of the answer track: in the studio
//         (ghost present) the real cells still fill the row as equal columns and
//         the ghost is a full-width strip BELOW them — BOTH grid families; the
//         live preview render carries the SAME cells and NO ghost (A-9).
//   AC-2  columns=1 renders a single full-width stacked column, studio + live,
//         BOTH families (A-7, Image26).
//   AC-3  a Contact stack shows a field label ABOVE every field that has one +
//         helper below; a label-less field renders NO empty label node (A-6a).
//   AC-4  add an Address, then a Dropdown with a show/hide rule on the Address's
//         STATE role → SAVE 2xx (no conditional_unknown_field) → the rule
//         round-trips on reload (closes P1a seam #1).
//   AC-5  [RETIRED §10/S5.1: MultiQuestionGrid removed from the catalog, no
//         successor for its shared-choices-across-rows shape] — used to
//         prove an MQG whose shared choices number 6 (with 2 rows) SAVES
//         (2xx), orphans pruned, never the raw 2-4 "pill set" 400 (R4-34).
//   AC-6  review-round finding 3: the studio/preview-only markup
//         (.lg-address-composite / .lg-mqg-empty) is truly INVISIBLE on the
//         REAL live /lg/:slug route (serve.ts's serveFunnelShell — NOT
//         /sections/preview, which carries .lg-preview itself) — proved via
//         getComputedStyle + offsetParent in a real browser DOM, not a CSS-
//         rule-text pin. A zero-row MultiQuestionGrid can never be SAVED
//         through the app (validateSectionContent rejects an empty rows
//         array), so it is seeded the same way genuinely pre-existing legacy
//         content would exist: a section saved valid, then its content_json
//         directly corrupted in the SAME local D1 the dev server reads (the
//         listicles-analytics-mirror.spec.ts `wrangler d1 execute --local`
//         precedent) — never through a product-code bypass.
//
// chromium-only: every action is a plain click / fill / selectOption — no
// gesture/drag machinery. AC-6 additionally drives a REAL tenant-host live
// funnel (leadgen-live-funnel.spec.ts / leadgen-b-seed.ts precedent), so this
// file maps the `*.e2e.test` TLD to loopback at the browser-launch level —
// inert for AC-1..AC-5, which never navigate to an e2e.test host.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function createSection(
  request: APIRequestContext,
  name: string,
  components: unknown[],
): Promise<{ id: number; public_id: string }> {
  return json(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: `p1b-act-${uniq}`,
        vertical: `p1b-vert-${uniq}`,
        headline_text: "P1b",
        continue_mode: "button",
        status: "active",
        content_json: { components },
      },
    }),
    `p1b section create (${name})`,
  );
}

// AC-6 only: a raw write against the SAME local D1 the wrangler-dev webServer
// reads (listicles-analytics-mirror.spec.ts's `wrangler d1 execute --local`
// precedent) — used ONLY to simulate legacy/pre-validation content_json that
// the app itself can never persist (validateSectionContent hard-rejects an
// empty MultiQuestionGrid rows array; this is not a product-code path).
function d1Local(command: string): void {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--command", command],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
}
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// The live-equivalent render MARKUP (NO studio decoration ghost) straight from
// the shared preview producer — same renderSectionComponents the live funnel
// uses. Markup only (never the chrome CSS, which legitimately NAMES the ghost
// class in its scoped rule) so substring checks read the DOM, not the sheet.
async function previewHtml(request: APIRequestContext, components: unknown[]): Promise<string> {
  const body = await json<Record<string, unknown>>(
    await request.post(`${LG_API}/sections/preview`, {
      data: { content_json: JSON.stringify({ components }), viewport: "desktop" },
    }),
    "p1b preview",
  );
  const preview = (body["preview"] as Record<string, unknown> | undefined) ?? body;
  return String(preview["html"] ?? preview["desktop"] ?? preview["mobile"] ?? "");
}

function canvas(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
}
function palette(page: Page, type: string) {
  return page.locator(`[data-add-component="${type}"]`);
}
async function openEdit(page: Page, publicId: string) {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };
async function boxes(page: Page, selector: string): Promise<Box[]> {
  const loc = canvas(page).locator(selector);
  const n = await loc.count();
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const b = await loc.nth(i).boundingBox();
    if (b) out.push(b);
  }
  return out;
}

const BUTTON_GROUP = {
  type: "ButtonAnswerGroup",
  question_id: "b1",
  internal_field: "pick",
  choices: [
    { label: "Alpha", value: "a", analytics_id: "a" },
    { label: "Beta", value: "b", analytics_id: "b" },
  ],
};
const CARD_GRID = {
  type: "IconCardAnswerGrid",
  question_id: "g1",
  internal_field: "biz",
  choices: [
    { icon: "briefcase", label: "One", value: "one", analytics_id: "one" },
    { icon: "home", label: "Two", value: "two", analytics_id: "two" },
  ],
};

// ---------------------------------------------------------------------------
// AC-1 — the ghost is out of the answer track (A-9)
// ---------------------------------------------------------------------------
test.describe("P1b AC-1 — '+ Add choice' ghost out of the grid track", () => {
  test("real cells fill the row as equal columns; the ghost is a full-width strip below (both families); live render has no ghost", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P1b ghost ${uniq}`, [BUTTON_GROUP, CARD_GRID]);
    await openEdit(page, section.public_id);

    // The studio injects the ghosts on canvas render — wait for BOTH families.
    await expect(canvas(page).locator(".lg-answer-group .studio-choice-ghost")).toBeVisible();
    await expect(canvas(page).locator(".lg-card-grid .studio-choice-ghost")).toBeVisible();

    // --- button group (2 equal-track cols): cells equal + same row; the two
    //     cells FILL the 2-col row (no track consumed); ghost = full-width strip
    //     below, spanning BOTH tracks (grid-column 1/-1), never a single cell ---
    const btnCells = await boxes(page, ".lg-answer-group .lg-btn-answer");
    const [btnGroup] = await boxes(page, ".lg-answer-group");
    const [btnGhost] = await boxes(page, ".lg-answer-group .studio-choice-ghost");
    expect(btnCells.length, "2 real button cells").toBe(2);
    expect(Math.abs(btnCells[0].width - btnCells[1].width)).toBeLessThanOrEqual(2);
    expect(Math.abs(btnCells[0].y - btnCells[1].y)).toBeLessThanOrEqual(2);
    expect(btnCells[0].width + btnCells[1].width).toBeGreaterThan(btnGroup.width * 0.85);
    expect(btnGhost.width).toBeGreaterThan(btnGroup.width * 0.85); // full row, not one track
    expect(btnGhost.width).toBeGreaterThan(btnCells[0].width * 1.5); // spans > one cell
    expect(btnGhost.y).toBeGreaterThan(btnCells[0].y + btnCells[0].height - 2); // below

    // --- card grid (default 3 equal tracks; 2 cards occupy 2 tracks, unchanged
    //     by the ghost): cards equal + same row; ghost = full-width strip below,
    //     spanning ALL tracks — decisively WIDER than a single card (the old bug
    //     made the ghost a peer 1-track card) ---
    const cardCells = await boxes(page, ".lg-card-grid .lg-card:not(.studio-choice-ghost)");
    const [cardGrid] = await boxes(page, ".lg-card-grid");
    const [cardGhost] = await boxes(page, ".lg-card-grid .studio-choice-ghost");
    expect(cardCells.length, "2 real cards").toBe(2);
    expect(Math.abs(cardCells[0].width - cardCells[1].width)).toBeLessThanOrEqual(2);
    expect(Math.abs(cardCells[0].y - cardCells[1].y)).toBeLessThanOrEqual(2);
    expect(cardGhost.width).toBeGreaterThan(cardGrid.width * 0.85); // spans the full grid
    expect(cardGhost.width).toBeGreaterThan(cardCells[0].width * 1.5); // not a peer 1-track card
    expect(cardGhost.y).toBeGreaterThan(cardCells[0].y + cardCells[0].height - 2); // below

    // --- live render carries the SAME cells and NO ghost ---
    const live = await previewHtml(page.request, [BUTTON_GROUP, CARD_GRID]);
    expect(live).not.toContain("studio-choice-ghost");
    expect((live.match(/lg-btn-answer/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((live.match(/class="lg-card"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — columns=1 single full-width stacked column (A-7)
// ---------------------------------------------------------------------------
test.describe("P1b AC-2 — columns=1 renders a full-width stacked column", () => {
  test("a 1-column button group AND card grid stack full-width in studio + live", async ({ page }) => {
    const bg = { ...BUTTON_GROUP, props: { columns: 1 } };
    const cg = { ...CARD_GRID, props: { columns: 1 } };
    const section = await createSection(page.request, `P1b cols1 ${uniq}`, [bg, cg]);
    await openEdit(page, section.public_id);
    await expect(canvas(page).locator(".lg-answer-group .lg-btn-answer").first()).toBeVisible();

    // button group: the 2 cells STACK (equal full width, cell 2 below cell 1)
    const btn = await boxes(page, ".lg-answer-group .lg-btn-answer");
    const [btnGroup] = await boxes(page, ".lg-answer-group");
    expect(btn.length).toBe(2);
    expect(btn[0].width).toBeGreaterThan(btnGroup.width * 0.85);
    expect(btn[1].width).toBeGreaterThan(btnGroup.width * 0.85);
    expect(btn[1].y).toBeGreaterThan(btn[0].y + btn[0].height - 2);

    // card grid: same 1-column stack
    const card = await boxes(page, ".lg-card-grid .lg-card:not(.studio-choice-ghost)");
    const [cardGrid] = await boxes(page, ".lg-card-grid");
    expect(card.length).toBe(2);
    expect(card[0].width).toBeGreaterThan(cardGrid.width * 0.85);
    expect(card[1].y).toBeGreaterThan(card[0].y + card[0].height - 2);

    // live: the shared producer emits --lg-cols:1 for both grids
    const live = await previewHtml(page.request, [bg, cg]);
    expect((live.match(/--lg-cols:1/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — unified field chrome: label above every labeled field (A-6a)
// ---------------------------------------------------------------------------
test.describe("P1b AC-3 — a Contact stack labels every field, none empty", () => {
  test("Email/Phone show a label above the input + helper below; a label-less field renders no empty label", async ({
    page,
  }) => {
    const contact = {
      type: "Stack",
      question_id: "stack1",
      children: [
        { type: "NameFieldsGroup", question_id: "nm" },
        { type: "EmailInputQuestion", question_id: "em", internal_field: "email", props: { label: "Email address", helper: "We never spam." } },
        { type: "PhoneInputQuestion", question_id: "ph", internal_field: "phone", props: { label: "Phone number" } },
        { type: "FreeTextQuestion", question_id: "ft", internal_field: "extra" },
      ],
    };
    const section = await createSection(page.request, `P1b chrome ${uniq}`, [contact]);
    await openEdit(page, section.public_id);

    const emailLabel = canvas(page).locator('.lg-label', { hasText: "Email address" });
    const phoneLabel = canvas(page).locator('.lg-label', { hasText: "Phone number" });
    await expect(emailLabel).toBeVisible();
    await expect(phoneLabel).toBeVisible();

    // the Email label sits ABOVE its input, and its helper BELOW.
    const emailInput = canvas(page).locator('[data-component-type="EmailInputQuestion"]');
    const lblBox = await emailLabel.boundingBox();
    const inBox = await emailInput.boundingBox();
    expect(lblBox && inBox && lblBox.y < inBox.y, "email label above input").toBeTruthy();
    await expect(canvas(page).locator(".lg-field-help", { hasText: "We never spam." })).toBeVisible();

    // NO empty label leaked: labels are exactly NameFields(2) + Email(1) + Phone(1);
    // the label-less FreeText added ZERO — never an empty <span class="lg-label">.
    await expect(canvas(page).locator(".lg-label")).toHaveCount(4);
    const emptyLabels = await canvas(page)
      .locator(".lg-label")
      .evaluateAll((els) => els.filter((e) => (e.textContent ?? "").trim() === "").length);
    expect(emptyLabels, "no empty label node").toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — a rule on an Address role saves + round-trips (closes P1a seam #1)
// ---------------------------------------------------------------------------
async function selectRuleSource(page: Page, roleWord: string): Promise<string> {
  const when = page.locator('[data-inspector-cond="when"]');
  const value = await when.evaluate((el, word) => {
    const opt = Array.from((el as HTMLSelectElement).options).find((o) => (o.textContent ?? "").includes(word));
    return opt ? opt.value : "";
  }, roleWord);
  if (!value) throw new Error(`no rule-source option for role "${roleWord}"`);
  await when.selectOption(value);
  return value;
}

test.describe("P1b AC-4 — Address-role rule saves + round-trips", () => {
  test("a Dropdown gated on the Address STATE role saves 2xx (no conditional_unknown_field) and persists on reload", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P1b rule ${uniq}`, [
      { type: "QuestionHeadline", question_id: "qh", bind: "section_headline" },
    ]);
    await openEdit(page, section.public_id);

    // Insert Address, then a Dropdown (which becomes the selection).
    await palette(page, "AddressAutocompleteQuestion").click();
    await expect(canvas(page).locator('[data-component-type="AddressAutocompleteQuestion"]')).toHaveCount(1);
    await palette(page, "DropdownQuestion").click();

    // Author a show/hide rule on the Address STATE role via the real Rules tab.
    await page.locator('[data-studio-inspector-tab="rules"]').click();
    await page.locator("[data-rules-add-condition]").click();
    const stateField = await selectRuleSource(page, "State");
    await page.locator('[data-inspector-cond="op"]').selectOption("eq");
    await page.locator('[data-inspector-cond="value"]').fill("CA");

    // Save — the rule references address_state, which P1b's collectKnownFields now
    // exposes, so validateConditional passes (no conditional_unknown_field 400).
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/admin\/leadgen\/sections\//.test(r.url()) && ["PUT", "PATCH", "POST"].includes(r.request().method()),
      ),
      page.locator("#lg-section-save").click(),
    ]);
    const saveBody = await saveResp.text().catch(() => "(body unavailable)");
    expect(saveResp.status(), `save status (${saveBody})`).toBeLessThan(300);

    // Round-trip: the persisted content carries the rule on the SAME field.
    const fetched = await json<{ content_json?: { components?: Array<{ type: string; conditional?: { when?: string } }> } }>(
      await page.request.get(`${LG_API}/sections/${section.id}`),
      "p1b fetch section",
    );
    const dropdown = (fetched.content_json?.components ?? []).find((c) => c.type === "DropdownQuestion");
    expect(dropdown?.conditional?.when, "rule persisted on the Address role").toBe(stateField);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — the MQG save trap is dead (R4-34) [RETIRED: §10/S5.1]
// ---------------------------------------------------------------------------
// MultiQuestionGrid is fully removed from the catalog (confirmed 0
// references anywhere, P5 orphan-scan) — this test's entire premise (a
// SHARED choices array spanning multiple rows, pruned to a 2-4 pill bound at
// save) has no successor concept: MultiQuestionGrid was the ONLY component
// type with a shared-choices-across-rows shape, so there is no other live
// type to port this "orphan pruning" journey to. A stored MQG node (from
// before this removal) rendering the fail-safe box rather than crashing is
// proven in test/leadgen-rework-render.test.ts's "§10 seam: a stored node of
// ANY extinct type (RangeQuestion/CurrencyRangeQuestion/MultiQuestionGrid/
// OtherGroupSelector) renders the fail-safe box, NEVER its old widget or a
// 500 (L-192)" test. The save-time "orphans prune, never 400" VALIDATION
// BEHAVIOR itself (content-schema.ts) has no proof anywhere else in this
// suite now that its only consumer (MQG) is gone — a genuine gap, not
// silently dropped, since no other component shape currently exercises that
// code path.
test.describe("P1b AC-5 — MQG with 6 shared choices saves (orphans pruned) [RETIRED: §10/S5.1, MultiQuestionGrid removed]", () => {
  test("the retired MultiQuestionGrid type is rejected at save, never silently accepted", async ({ page }) => {
    const res = await page.request.post(`${LG_API}/sections`, {
      data: {
        section_name: `P1b mqg6 ${uniq}`,
        activity: `p1b-act-${uniq}`,
        vertical: `p1b-vert-${uniq}`,
        headline_text: "P1b",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            {
              type: "MultiQuestionGrid",
              question_id: "q_grid",
              choices: [
                { label: "Yes", value: "yes", analytics_id: "yes" },
                { label: "No", value: "no", analytics_id: "no" },
              ],
              props: { rows: [{ label: "Homeowner", internal_field: "homeowner", default: "yes" }] },
            },
          ],
        },
      },
    });
    expect(res.status(), "MultiQuestionGrid is rejected, never silently accepted").toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — review-round finding 3: live-DOM invisibility proof (not a CSS-text pin)
// ---------------------------------------------------------------------------
test.describe("P1b AC-6 — studio-only markup is truly invisible on the live /lg funnel", () => {
  test("an Address composite + zero-row MQG empty-state ship display:none + no box on the REAL live route; the live root carries no .lg-preview", async ({
    page,
  }) => {
    const host = `p1b-live-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(page.request, host, `P1b live ${uniq}`);

    // A section that SAVES valid (Address alone — content-schema requires no
    // internal_field on AddressAutocompleteQuestion) …
    const section = await json<{ id: number; public_id: string }>(
      await page.request.post(`${LG_API}/sections`, {
        data: {
          section_name: `P1b live section ${uniq}`,
          activity: "p1b_live_quote_funnel",
          vertical: "p1b_live",
          headline_text: "P1b live",
          continue_mode: "button",
          status: "active",
          content_json: { components: [{ type: "AddressAutocompleteQuestion", question_id: "addr1" }] },
        },
      }),
      "p1b live section create",
    );

    // … then corrupted DIRECTLY in D1 to ALSO carry a zero-row MultiQuestionGrid
    // — the only way this state can exist (the app's own save-time validator
    // rejects an empty rows array outright; see the header comment).
    const corruptedContent = JSON.stringify({
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "addr1" },
        { type: "MultiQuestionGrid", question_id: "grid1", props: { rows: [] } },
      ],
    });
    d1Local(`UPDATE leadgen_sections SET content_json = ${sqlStr(corruptedContent)} WHERE public_id = ${sqlStr(section.public_id)};`);

    // Quote → funnel → control variant carrying that ONE section; activate on
    // the seeded site (the leadgen-b-seed.ts / leadgen-live-funnel.spec.ts
    // recipe for reaching the REAL /lg/:slug producer).
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await page.request.post(`${LG_API}/quotes`, {
        data: { quote_name: `P1b live quote ${uniq}`, activity: "p1b_live_quote_funnel", verticals: ["p1b_live"] },
      }),
      "p1b live quote create",
    );
    const controlVariantId = quote.funnels[0]!.variants[0]!.public_id;
    await json(
      await page.request.put(`${LG_API}/variants/${controlVariantId}`, {
        data: { sections: [{ section_id: section.id, position: 0 }] },
      }),
      "p1b live variant sections",
    );
    const slug = `p1b-live-${uniq}`;
    await json(
      await page.request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, {
        data: { enabled: true, slug },
      }),
      "p1b live activation",
    );

    // The REAL live route (serve.ts serveFunnelShell) on the tenant host —
    // never /sections/preview, which itself carries the .lg-preview wrapper.
    await page.goto(`http://${host}:${PW_PORT}/lg/${slug}`, { waitUntil: "domcontentloaded" });

    // The guard premise itself: the live root does NOT carry .lg-preview (the
    // class every display:none→block override in styles.ts keys off).
    const root = page.locator("#lg-funnel-root");
    await expect(root).toBeVisible();
    expect(await root.evaluate((el) => el.classList.contains("lg-preview")), "live root has no .lg-preview").toBe(false);

    // Both studio/preview-only elements are PRESENT in the live DOM (the
    // renderer emits them unconditionally) …
    const composite = page.locator(".lg-address-composite");
    const empty = page.locator(".lg-mqg-empty");
    await expect(composite).toHaveCount(1);
    await expect(empty).toHaveCount(1);

    // … but truly invisible: computed display is 'none' AND each has no box
    // (offsetParent null — the two-signal invisibility proof, not a CSS-rule
    // string comparison).
    for (const [name, loc] of [["address composite", composite] as const, ["mqg empty-state", empty] as const]) {
      const display = await loc.evaluate((el) => getComputedStyle(el).display);
      expect(display, `${name} computed display`).toBe("none");
      const hasBox = await loc.evaluate((el) => (el as HTMLElement).offsetParent !== null);
      expect(hasBox, `${name} offsetParent (should be null / no box)`).toBe(false);
    }
  });
});
