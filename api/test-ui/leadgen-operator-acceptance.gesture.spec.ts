// Section Builder product-core remediation — THE OPERATOR ACCEPTANCE SUITE
// (register docs/leadgen/product-core/register.md §A rows PC-1..12; program of
// 2026-07-16). This is the P5 close's terminal artifact: the operator failed the
// product THREE times with their own hands, so the close re-scripts THEIR 12
// items (the 2026-07-16 message + Images 1-14) as live operator journeys — real
// studio authoring composed into live funnel behavior, the way they actually
// work. One test per item, named "Item N — <their words>".
//
// THE JOURNEY LAYER, NOT A REPLACEMENT. Every mechanism below is ALSO pinned by a
// deeper gate (the register maps each PC row to its proving gate); each test's
// header cites that gate. This suite proves the mechanisms COMPOSE the way the
// operator uses them, end to end, in one readable file.
//
// CROSS-ENGINE DESIGN (playwright.config.ts CROSS_ENGINE_GESTURE_SPECS — this file
// is registered there, so it runs on BOTH the chromium and firefox projects):
//   • The studio / canvas / admin-UI / API-authoring assertions are engine-
//     agnostic (real clicks + real page.mouse via the U13 srcdoc delivery fix +
//     getBoundingClientRect + admin HTTP) and run on BOTH engines.
//   • The LIVE-/lg legs drive a dynamic `{uniq}.e2e.test` tenant host, resolved
//     by chromium's `--host-resolver-rules` (test.use below). firefox's
//     `network.dns.localDomains` cannot resolve a wildcard/suffix host (the
//     repo-wide constraint every deeper gate documents — leadgen-p1-geometry /
//     leadgen-p4b-validation / leadgen-p4c-rules / leadgen-p3a-placement), so
//     each item's live leg is guarded by liveLegChromiumOnly(): the studio/canvas
//     assertions ABOVE it run on firefox, then the test annotates a documented
//     live-leg skip and returns. Items 2/3/8/9 carry NO dynamic-host leg and run
//     fully on both engines. Net (A4): chromium runs every journey in full;
//     firefox runs every journey's both-engine portion + records each skipped
//     live leg. ZERO dispatchEvent anywhere (register root rule).
//
// Run per-file with the worktree-isolated fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-operator-acceptance.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
//   PW_PORT=8899 npx playwright test test-ui/leadgen-operator-acceptance.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { defaultFunnelDesign as D } from "../src/public/leadgen/designs/default-funnel/tokens";
import { baseTokenForRole } from "../src/public/leadgen/designs/theme";
import { seedActiveSite } from "./listicles-p6-seed";
import { seedFixP1Funnel } from "./leadgen-fix-p1-seed";
import { PW_PORT } from "./utils/base-url";

const LG_API = "/api/admin/leadgen";
const PORT = PW_PORT;
const uniq = Date.now();

// The chromium host-resolver arg maps every seeded *.e2e.test tenant host to
// loopback for the live /lg legs (harmless to the studio tests, which navigate
// 127.0.0.1 only). REAL_CHROME_UA: the live /lg/auction runtimeRequestGuard's UA
// heuristics 403 a headless UA in dev (no request.cf locally) — Item 10's auction
// leg needs a realistic desktop Chrome UA (the leadgen-live-funnel.spec.ts
// DEV-GUARD contract); inert to every other leg.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

// Token expectations the operator's Image1/Image3 reference numbers pin (a drift
// in tokens.ts fails here, exactly like the deeper geometry gate).
const STACK = parseFloat(D.spacing.stack); // 18 — the inter-component rhythm floor
const AG_GAP = parseFloat(D.answerGrid.gap); // 24 — the answer-grid gutter token
const CELL_MIN_H = parseFloat(D.primaryButton.minHeight); // 52
const ACCENT_HEX = baseTokenForRole(D, "accent"); // #E85D26 — the operator's orange
const ACCENT_RGB = "rgb(232, 93, 38)"; // #E85D26 resolved
const OFF_THEME_HEX = "#D92D20"; // a deliberate off-palette red

// ---------------------------------------------------------------------------
// Shared helpers — reuse the established studio + live-funnel + real-input
// patterns (leadgen-p4d-editor / leadgen-p4b-validation / leadgen-p3a-placement /
// leadgen-fix-p1-seed); nothing reinvented.
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

// A studio-authorable Section (activity/vertical "quote_funnel"/"life" so any
// live leg's quote — verticals:["life"] — can attach it).
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

async function fetchSection(
  request: APIRequestContext,
  publicId: string,
): Promise<{ content_json: { components: Array<Record<string, unknown>>; continue_visible_when?: unknown } }> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), `section detail (${publicId})`);
}

const frameOf = (page: Page) => page.frameLocator("#lg-studio-canvas-frame");
const canvasRender = (page: Page) => frameOf(page).locator("#lg-studio-canvas-render");

async function bootStudio(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(frameOf(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}

// Robust save: a clean save reloads (a body read would race the navigation
// teardown), a save that surfaces a problem stays (no reload) — wait for the
// PATCH itself, assert 2xx, and read the body only on failure for diagnostics.
async function saveStudioAwaitOk(page: Page, publicId: string): Promise<void> {
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
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

// Seed a minimal live funnel from ALREADY-CREATED section ids (the p4b/p4c seed
// shape: active *.e2e.test site → quote/variant → ordered sections → activation).
async function seedLiveFunnel(
  request: APIRequestContext,
  tag: string,
  sectionIds: number[],
): Promise<{ host: string; slug: string }> {
  // ALL identity here is namespaced to THIS suite: host/site-name/quote-name
  // carry the "acc-"/"ACC " suite prefix (Acceptance) + the per-item tag
  // (e.g. "item1") + a fresh Date.now()+random suffix — disjoint by
  // construction from every other spec's fixtures (see the conductor-audited
  // identity table in the phase report; grep "acc-" / "ACC " to verify no
  // other test-ui/*.spec.ts file emits this prefix).
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `acc-${tag}-${u}.e2e.test`;
  const slug = `acc-${tag}`;
  const siteId = await seedActiveSite(request, host, `ACC ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `ACC ${tag} ${u}`, activity: "quote_funnel", verticals: ["life"] },
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
  // preflights "the shared first page needs at least one section" — this
  // pre-M2 helper predates that requirement. Seed a TRIVIAL pass-through
  // shared page (a single ContinueButton, no questions) so every live leg
  // advances through it in one click (passSharedPage below) before reaching
  // the funnel content under test — the SAME pattern already proven in
  // leadgen-rework-p2-studio.gesture.spec.ts / __p2c-studio.spec.ts /
  // leadgen-round4-acceptance.gesture.spec.ts.
  const trivialShared = await createStudioSection(request, `ACC shared ${tag} ${u}`, [
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

const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PORT}/lg/${s.slug}`;

// Click the trivial shared-page's Continue button once (see seedLiveFunnel's
// own comment) so a live leg lands on the funnel content under test.
async function passSharedPage(page: Page): Promise<void> {
  const cont = page.locator("[data-lg-continue]").first();
  await expect(cont, "the shared page's Continue is reachable").toBeVisible({ timeout: 8_000 });
  await cont.click();
}

// A trivial trailing Section so an "advance" leg has somewhere to land (the p4b
// NEXT pattern — section_index only increments when a next section exists).
async function createNextSection(request: APIRequestContext): Promise<Created> {
  return createStudioSection(request, `ACC Next ${uniq}-${Math.random().toString(36).slice(2, 7)}`, [
    { type: "QuestionHeadline", question_id: "q_next_head", bind: "section_headline" },
    { type: "TwoButtonYesNo", question_id: "q_next", internal_field: "next_ok", props: { yesLabel: "Yes", noLabel: "No" } },
  ]);
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 10_000 });
}
const sectionIndex = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index,
  );
const liveSection = (page: Page, i: number) => page.locator(`[data-lg-section][data-lg-index="${i}"]`);

// The dynamic-host live leg is chromium-only. On firefox: record a DOCUMENTED
// skip annotation (visible in the reporter) and signal the caller to return
// after its both-engine studio/canvas/API assertions.
function liveLegChromiumOnly(browserName: string, reason: string): boolean {
  if (browserName === "firefox") {
    test.info().annotations.push({ type: "live-leg-skip", description: reason });
    return false;
  }
  return true;
}

// A held-button press-drag that leaves the button down so a mid-drag guideline
// can be observed before release (the leadgen-p3a-placement pressDragTo; real
// page.mouse, NEVER dispatchEvent).
async function pressDragTo(page: Page, fromLoc: Locator, to: { x: number; y: number }, steps = 6): Promise<void> {
  const fb = await fromLoc.boundingBox();
  if (!fb) throw new Error("pressDragTo: source has no bounding box");
  const from = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + dx * i, from.y + dy * i);
  await page.mouse.move(to.x, to.y);
}
async function thirdPoint(loc: Locator, side: "left" | "right"): Promise<{ x: number; y: number }> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("thirdPoint: target has no bounding box");
  return { x: b.x + b.width * (side === "left" ? 0.15 : 0.85), y: b.y + b.height * 0.5 };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
// Measure a ButtonAnswerGroup answer grid (tracks + per-cell rects + card
// content box) — reused for the studio canvas (in-iframe) and the live top
// document. `inIframe` selects which document to read.
async function measureAnswerGrid(
  page: Page,
  qid: string,
  inIframe: boolean,
): Promise<{ tracks: number; cells: Box[]; groupBox: Box; cardBox: Box; padL: number; padR: number } | null> {
  return page.evaluate(
    ({ qid, inIframe }) => {
      const doc = inIframe
        ? (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument ?? null
        : document;
      const view = inIframe ? doc?.defaultView ?? null : window;
      if (!doc || !view) return null;
      const rect = (el: Element | null): Box | null =>
        el ? (() => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })() : null;
      const group = doc.querySelector(`[data-question-id="${qid}"]`);
      if (!group) return null;
      const cells = [...group.querySelectorAll(".lg-btn-answer")].map((b) => rect(b)!).filter(Boolean);
      const tracks = view.getComputedStyle(group).gridTemplateColumns.trim().split(/\s+/).length;
      // LeadGen Rework §4.3-1 (own-hand-verified: fail-before/pass-after +
      // presets.ts:3149-3150 read): a document-wide
      // doc.querySelector(".lg-question-card") (the pre-existing form) is
      // ambiguous once seedLiveFunnel's trivial shared page coexists in the
      // live DOM alongside the funnel's own section — renderQuestionCard
      // wraps EACH section's own depth-1 content in its own
      // .lg-question-card (one per [data-lg-section], the runtime keeps
      // every section mounted and visibility-toggles by data-lg-index, per
      // liveSection()'s own per-index locator convention below). The FIRST
      // document-order match became the shared page's own (now-hidden,
      // zero-rect) card, corrupting cardBox/padL/padR (observed failure:
      // "group centered in the card column (640 vs 0)" — contentCenter
      // computed from a zero cardBox). .closest() scopes the lookup to the
      // ACTUAL measured group's own enclosing card instead — correct
      // regardless of how many sections are simultaneously mounted, and
      // unaffected in the single-section studio-iframe case (inIframe=true)
      // since .closest() degrades to the same unique match there.
      const card = group.closest(".lg-question-card");
      const cardCs = card && view.getComputedStyle(card);
      return {
        tracks,
        cells,
        groupBox: rect(group)!,
        cardBox: rect(card)!,
        padL: cardCs ? parseFloat(cardCs.paddingLeft) || 0 : 0,
        padR: cardCs ? parseFloat(cardCs.paddingRight) || 0 : 0,
      };
    },
    { qid, inIframe },
  );
}

// Assert the Image1 reference numbers on a measured 2-col answer grid: 2 tracks,
// equal cell widths ±1px, the intra-row column gap == answerGrid.gap, cells ≥52
// tall. `expectCentered` (live only) also checks the group is centered in the
// card content column.
function assertReferenceGrid(
  m: { tracks: number; cells: Box[]; groupBox: Box; cardBox: Box; padL: number; padR: number },
  expectCentered: boolean,
): void {
  expect(m.tracks, "2-col answer grid").toBe(2);
  expect(m.cells.length, "six answer cells render").toBe(6);
  const widths = m.cells.map((c) => c.w);
  const wMin = Math.min(...widths);
  const wMax = Math.max(...widths);
  expect(wMax - wMin, `all six cells equal width ±1px (min ${wMin} max ${wMax})`).toBeLessThanOrEqual(1.5);
  for (const c of m.cells) expect(c.h, `cell height ${c.h} ≥ ${CELL_MIN_H}`).toBeGreaterThanOrEqual(CELL_MIN_H - 0.5);
  // The first row's two cells sit side by side; their gap == the gutter token.
  const row0 = m.cells.filter((c) => Math.abs(c.y - m.cells[0]!.y) <= 2).sort((a, b) => a.x - b.x);
  expect(row0.length, "two cells in the first row (2 columns)").toBe(2);
  const colGap = +(row0[1]!.x - (row0[0]!.x + row0[0]!.w)).toFixed(1);
  expect(Math.abs(colGap - AG_GAP), `column gap ${colGap} == answerGrid.gap ${AG_GAP}`).toBeLessThanOrEqual(1.5);
  if (expectCentered) {
    const contentCenter = m.cardBox.x + m.padL + (m.cardBox.w - m.padL - m.padR) / 2;
    const groupCenter = m.groupBox.x + m.groupBox.w / 2;
    expect(Math.abs(groupCenter - contentCenter), `group centered in the card column (${groupCenter} vs ${contentCenter})`).toBeLessThanOrEqual(1.5);
  }
}

// The reused Yes/No pill pair.
const YESNO = [
  { label: "Yes", value: "yes", analytics_id: "yes" },
  { label: "No", value: "no", analytics_id: "no" },
];

test.describe("Operator acceptance — the 12 live journeys (register §A PC-1..12)", () => {
  // =========================================================================
  // Item 1 — Buttons: reference 2-col grid, gutters, centered, sized (Image1)
  // Register PC-1 · deeper gate: leadgen-p1-geometry.gesture.spec.ts (the
  // studio+live geometry gate, both engines). Journey: REAL palette insert +
  // REAL choices editor build a 6-choice ButtonAnswerGroup, then the Image1
  // reference numbers hold on the canvas (both engines) AND the live funnel.
  // =========================================================================
  test('Item 1 — "buttons should be a 2-column grid, evenly guttered, centered and sized" (Image1)', async ({
    page,
    request,
    browserName,
  }) => {
    // Start from a headline-only Section, then BUILD the buttons in the studio.
    const s = await createStudioSection(request, `ACC Item1 buttons ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
    ]);
    await bootStudio(page, s);

    // REAL palette insert: click the golden "Buttons" tile (the §5.2 insert
    // semantics leadgen-studio-patterns proves) → a ButtonAnswerGroup lands.
    const canvasNodes = frameOf(page).locator('#lg-studio-canvas-render [data-component-type]');
    const before = await canvasNodes.count();
    await page.locator('[data-tile][data-name="buttons"]').first().click();
    await expect(canvasNodes).toHaveCount(before + 1, { timeout: 20_000 });
    const group = frameOf(page).locator('[data-component-type="ButtonAnswerGroup"]');
    await expect(group).toHaveCount(1);

    // REAL choices editor: a fresh group carries 2 sample choices; author up to
    // SIX (the Image1 count) through the "+ Add choice" control, then fill every
    // label/value so the six are real + unique.
    await openInspectorTab(page, "content");
    const choiceRows = page.locator("[data-inspector-choices] [data-choice-row]");
    await expect(choiceRows).toHaveCount(2);
    for (let i = 2; i < 6; i++) {
      await page.locator("#lg-choice-add").click();
      await expect(choiceRows).toHaveCount(i + 1);
    }
    const labels = ["Auto", "Home", "Life", "Health", "Renters", "Travel"];
    for (let i = 0; i < 6; i++) {
      const v = labels[i]!.toLowerCase();
      await choiceRows.nth(i).locator('input[data-choice-field="label"]').fill(labels[i]!);
      await choiceRows.nth(i).locator('input[data-choice-field="value"]').fill(v);
      // A newly added choice starts without an analytics_id (required, §22
      // tracking) — author it so all six persist.
      await choiceRows.nth(i).locator('input[data-choice-field="analytics_id"]').fill(`op1_${v}`);
    }
    // Save robustly (a save that surfaces a new non-blocking problem STAYS on the
    // page without a reload, so wait for the PATCH itself), then re-navigate to
    // read the clean saved canvas.
    const [savePatch] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/sections/${s.public_id}`) && r.request().method() === "PATCH"),
      page.locator("#lg-section-save").click(),
    ]);
    // status()/ok() read headers only — a clean save reloads the page, which
    // would make a body read (.text()) race the navigation teardown.
    expect(savePatch.ok(), `save PATCH status ${savePatch.status()}`).toBe(true);
    const savedRows = (await fetchSection(request, s.public_id)).content_json.components.find(
      (c) => c.type === "ButtonAnswerGroup",
    ) as { choices?: unknown[] };
    expect(savedRows.choices, "the six authored choices persist").toHaveLength(6);
    await bootStudio(page, s);

    // CANVAS (both engines): the Image1 reference numbers on the studio surface.
    const grid = frameOf(page).locator('[data-component-type="ButtonAnswerGroup"]');
    await expect(grid).toBeVisible();
    const qid = await grid.getAttribute("data-question-id");
    expect(qid, "the saved group carries a data-question-id hook").toBeTruthy();
    const canvasM = await measureAnswerGrid(page, qid!, true);
    expect(canvasM, "the canvas answer grid is measurable").not.toBeNull();
    assertReferenceGrid(canvasM!, false);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 1 live /lg render needs chromium --host-resolver-rules; the both-engine studio+live geometry proof is leadgen-p1-geometry.gesture.spec.ts (register PC-1). The canvas assertions above run on BOTH engines.",
      )
    )
      return;

    // LIVE: the SAME authored Section, attached to a funnel, renders the same
    // reference grid — centered in the card column (width:100% by construction).
    const seeded = await seedLiveFunnel(request, "item1", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now renders first — pass it before waiting on the real
    // question, same pattern as every other live leg in this file.
    await ready(page);
    await passSharedPage(page);
    await expect(page.locator(`[data-question-id="${qid}"]`).first()).toBeVisible({ timeout: 15_000 });
    const liveM = await measureAnswerGrid(page, qid!, false);
    expect(liveM, "the live answer grid is measurable").not.toBeNull();
    assertReferenceGrid(liveM!, true);
  });

  // =========================================================================
  // Item 2 — Drag = defining custom locations (R-B, Image-driven)
  // Register PC-2 · deeper gate: leadgen-p3a-placement.gesture.spec.ts (both-
  // engine drag + saved-model + chromium live parity). Journey: REAL mouse drag
  // one element beside another → a row forms with the beside guideline; the
  // alignment control moves it; the saved model records the row. The studio
  // canvas IS the same presets.ts server renderer the live funnel embeds
  // (documented in leadgen-p4d/p5 headers), so canvas parity == live parity;
  // p3a pins the dynamic-host live render itself (chromium). Runs BOTH engines
  // (the U13 srcdoc fix delivers the held-button page.mouse stream on both).
  // =========================================================================
  test('Item 2 — "let me drag one field beside another to place it where I want" (custom locations)', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `ACC Item2 drag ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TextBlock", question_id: "a", props: { role: "body", text: "Alpha" } },
      { type: "FreeTextQuestion", question_id: "b", internal_field: "b2", answer_type: "string", props: { placeholder: "Beta" } },
      // A lone, fixed-width element the alignment control can visibly move (a row
      // member's slot is content-sized, so align is meaningful on a lone width:m
      // box — the leadgen-p3a-placement (d) shape).
      { type: "FreeTextQuestion", question_id: "c", internal_field: "c2", answer_type: "string", props: { placeholder: "Solo" }, layout: { width: "m" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootStudio(page, s);
    const root = canvasRender(page);
    const A = frameOf(page).locator('[data-question-id="a"]');
    const B = frameOf(page).locator('[data-question-id="b"]');
    await expect(A).toBeVisible();
    await expect(B).toBeVisible();

    // Drag B onto A's RIGHT third, HELD — the vertical beside guideline shows on
    // the host BEFORE release (the operator's "place it right there" affordance).
    await pressDragTo(page, B, await thirdPoint(A, "right"));
    await expect(frameOf(page).locator(".studio-drop-beside-right"), "the vertical beside guideline appears").toHaveCount(1);
    await page.mouse.up();

    // The canvas re-renders a real .lg-el-row: A left of B, same y-band (WYSIWYG,
    // byte-identical to the live render).
    await expect(root.locator(".lg-el-row")).toBeVisible({ timeout: 10_000 });
    const members = root.locator(".lg-el-row > .lg-el");
    await expect(members).toHaveCount(2);
    const m1 = await members.nth(0).boundingBox();
    const m2 = await members.nth(1).boundingBox();
    if (!m1 || !m2) throw new Error("row members have no bounding box");
    expect(Math.abs(m1.y - m2.y), "row members share a y-band").toBeLessThanOrEqual(2);
    expect(m1.x + m1.width, "member 1 is left of member 2").toBeLessThanOrEqual(m2.x + 0.5);

    // The ALIGNMENT control works: select the lone width:m element C, Style tab →
    // align:start hugs left, align:end pushes right (a real, measured move).
    await frameOf(page).locator('[data-question-id="c"]').click();
    await openInspectorTab(page, "style");
    await expect(page.locator("[data-style-placement-block]")).toBeVisible({ timeout: 8000 });
    const lone = root.locator('.lg-el:has([data-question-id="c"])');
    await page.locator('[data-set-placement-align="start"]').click();
    await page.waitForTimeout(400);
    const startLeft = (await lone.boundingBox())!.x;
    await page.locator('[data-set-placement-align="end"]').click();
    await page.waitForTimeout(400);
    const endLeft = (await lone.boundingBox())!.x;
    expect(endLeft, "align:end renders C to the RIGHT of align:start").toBeGreaterThan(startLeft + 10);

    // SAVED MODEL: A and B share the SAME row id + C's align persists.
    await saveStudio(page);
    const comps = (await fetchSection(request, s.public_id)).content_json.components;
    const a = comps.find((c) => c.question_id === "a") as { layout?: { row?: string } };
    const b = comps.find((c) => c.question_id === "b") as { layout?: { row?: string } };
    const c = comps.find((cc) => cc.question_id === "c") as { layout?: { align?: string } };
    expect(a.layout?.row, "A carries a saved layout.row").toBeTruthy();
    expect(b.layout?.row, "A and B share the SAME saved row id").toBe(a.layout?.row);
    expect(c.layout?.align, "the authored align persists (last set = end)").toBe("end");

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 2 live-parity render needs chromium --host-resolver-rules; leadgen-p3a-placement.gesture.spec.ts pins the drag on BOTH engines and the dynamic-host live parity on chromium. The drag + saved-model assertions above run on BOTH engines.",
      )
    )
      return;

    // LIVE PARITY: the drag-formed row renders side-by-side on the real funnel
    // (the same layout.row the studio saved).
    const seeded = await seedLiveFunnel(request, "item2", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now renders first — pass it before waiting on the real row.
    await ready(page);
    await passSharedPage(page);
    await expect(page.locator(".lg-el-row").first()).toBeVisible({ timeout: 15_000 });
    const liveMembers = await page.evaluate(() => {
      const members = [...document.querySelectorAll(".lg-el-row > .lg-el")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, right: r.right };
      });
      return members;
    });
    expect(liveMembers.length, "live: the row renders 2 members side by side").toBe(2);
    expect(Math.abs(liveMembers[0]!.y - liveMembers[1]!.y), "live: row members share a y-band").toBeLessThanOrEqual(2);
    expect(liveMembers[0]!.right, "live: member 1 is left of member 2").toBeLessThanOrEqual(liveMembers[1]!.x + 0.5);
  });

  // =========================================================================
  // Item 3 — Yes/No reference quality + default inter-component spacing (Image3)
  // Register PC-3 · deeper gate: leadgen-p1-geometry.gesture.spec.ts (the RHYTHM
  // gate, the P10 zero-gap probe inverted). Journey (studio canvas, both
  // engines): TwoButtonYesNo renders two EQUAL cells, and EVERY adjacent
  // component pair measures ≥ the theme stack token — never the pre-P1a 0px.
  // =========================================================================
  test('Item 3 — "Yes/No should look reference-quality and components should not touch" (Image3 spacing)', async ({
    page,
    request,
  }) => {
    const s = await createStudioSection(request, `ACC Item3 spacing ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "insured3", answer_type: "boolean" },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_btn",
        internal_field: "cov3",
        answer_type: "enum",
        choices: [
          { label: "Basic", value: "basic", analytics_id: "b" },
          { label: "Full", value: "full", analytics_id: "f" },
        ],
      },
      { type: "FreeTextQuestion", question_id: "q_txt", internal_field: "note3", answer_type: "string", props: { placeholder: "Notes" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootStudio(page, s);
    await expect(frameOf(page).locator('[data-question-id="q_txt"]')).toBeVisible({ timeout: 20_000 });

    const measured = await page.evaluate(
      ({ order }) => {
        const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
        if (!doc) return null;
        const rect = (el: Element | null) => (el ? (() => { const r = el.getBoundingClientRect(); return { y: r.top, h: r.height, x: r.left, w: r.width }; })() : null);
        const ynCells = [...doc.querySelectorAll('[data-question-id="q_yn"] .lg-btn-answer')].map((b) => rect(b)!);
        const boxes = order.map((id) => rect(doc.querySelector(`[data-question-id="${id}"]`)));
        return { ynCells, boxes };
      },
      { order: ["q_yn", "q_btn", "q_txt", "q_cont"] },
    );
    expect(measured, "canvas is measurable").not.toBeNull();
    // TwoButtonYesNo: two EQUAL cells (the Image3 reference).
    expect(measured!.ynCells.length, "yes/no = two cells").toBe(2);
    expect(Math.abs(measured!.ynCells[0]!.w - measured!.ynCells[1]!.w), "equal yes/no widths").toBeLessThanOrEqual(1);
    expect(Math.abs(measured!.ynCells[0]!.h - measured!.ynCells[1]!.h), "equal yes/no heights").toBeLessThanOrEqual(1);
    // EVERY adjacent component pair is spaced ≥ the stack token (never 0px).
    const boxes = measured!.boxes;
    for (const b of boxes) expect(b, "every component renders").not.toBeNull();
    for (let i = 1; i < boxes.length; i++) {
      const gap = +(boxes[i]!.y - (boxes[i - 1]!.y + boxes[i - 1]!.h)).toFixed(1);
      expect(gap, `pair ${i - 1}->${i} gap ${gap} ≥ stack ${STACK} (the P10 zero-gap probe inverted)`).toBeGreaterThanOrEqual(STACK - 1.5);
    }
  });

  // =========================================================================
  // Item 4 — Contact: per-field controls + When-answered conflict + Required
  // Register PC-4 (PC-A8/PC-A1) · deeper gates: leadgen-p4d-editor (per-field),
  // studio setContinueMode lock (PC-A1), leadgen-p4b-validation (required-live).
  // Journey: author NameFieldsGroup per-field placeholders/helper/icon via the
  // REAL inspector → the canvas renders them (both engines); a 3-component
  // section shows "Go to next" LOCKED with the honest reason (both engines);
  // LIVE the required name blocks Continue with a VISIBLE message.
  // =========================================================================
  test('Item 4 — "Contact needs per-field controls, and Required must actually block" (Image5)', async ({
    page,
    request,
    browserName,
  }) => {
    // 3 components, 2 producers (NameFieldsGroup + ButtonAnswerGroup) → the
    // section can never auto-advance.
    const s = await createStudioSection(request, `ACC Item4 contact ${uniq}`, [
      { type: "NameFieldsGroup", question_id: "q_name", required: true, props: {} },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_pick",
        internal_field: "pick4",
        answer_type: "enum",
        choices: [
          { label: "Home", value: "home", analytics_id: "h" },
          { label: "Auto", value: "auto", analytics_id: "a" },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootStudio(page, s);

    // Per-field controls (both engines): author placeholders/helper/icon on the
    // REAL inspector → the SAME presets.ts renderer paints them on the canvas.
    await canvasRender(page).locator('[data-component-type="NameFieldsGroup"]').click();
    await openInspectorTab(page, "content");
    const block = page.locator("[data-content-namefieldsgroup-block]");
    await expect(block).toBeVisible();
    await block.locator('input[data-inspector-field="firstPlaceholder"]').fill("Jane");
    await block.locator('input[data-inspector-field="lastPlaceholder"]').fill("Doe");
    await block.locator('input[data-inspector-field="firstHelper"]').fill("As shown on your ID");
    await block.locator('select[data-inspector-field="firstIcon"]').selectOption("user");
    await expect(canvasRender(page).locator('input[data-name-field="first"]')).toHaveAttribute("placeholder", "Jane", { timeout: 5_000 });
    await expect(canvasRender(page).locator('input[data-name-field="last"]')).toHaveAttribute("placeholder", "Doe");
    await expect(canvasRender(page).locator("text=As shown on your ID")).toBeVisible();
    await expect(canvasRender(page).locator(".lg-field-icon")).toHaveCount(1);

    // "Go to next" LOCKED with the honest reason (both engines): a 2-producer
    // section cannot auto-advance; the control is aria-disabled + the lock note
    // explains why, in the operator's own words.
    const goNext = page.locator('[data-continue-mode="auto_advance"]').first();
    await expect(goNext).toHaveAttribute("aria-disabled", "true");
    const lockNote = page.locator("[data-continue-lock-note]").first();
    await expect(lockNote).toBeVisible();
    await expect(lockNote).toContainText("answer components");
    await expect(lockNote).toContainText("Continue button");
    await saveStudio(page);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 4 live required-blocks-Continue needs chromium --host-resolver-rules; leadgen-p4b-validation pins the live required behavior and leadgen-p4d-editor pins per-field authoring on BOTH engines. The studio assertions above run on BOTH engines.",
      )
    )
      return;

    // LIVE: the authored placeholders render, and the empty required name blocks
    // Continue with a VISIBLE, non-empty message.
    const seeded = await seedLiveFunnel(request, "item4", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on this funnel's own first (and only) page at index 1.
    await passSharedPage(page);
    await expect(liveSection(page, 1).locator('input[data-name-field="first"]')).toHaveAttribute("placeholder", "Jane");
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "empty required name must block Continue").toBe(1);
    const slot = liveSection(page, 1).locator('[data-lg-error-for="q_name"]');
    await expect(slot).toBeVisible();
    await expect(slot).not.toHaveText("");
  });

  // =========================================================================
  // Item 5 — Date: dynamic Min (today/+7d/year), validated static input (Image6)
  // Register PC-5 (PC-A5) · deeper gate: leadgen-p4b-validation.spec.ts. Journey:
  // author Min=+7d through the REAL token picker (both engines) → the token
  // persists; garbage bounds are UNAUTHORABLE (API 400, both engines); LIVE the
  // funnel enforces the concrete resolved date with the exact message.
  // =========================================================================
  test('Item 5 — "Date needs a dynamic minimum like +7 days, and garbage bounds must not save" (Image6)', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `ACC Item5 date ${uniq}`, [
      { type: "DateQuestion", question_id: "q_date", internal_field: "d", required: true, props: {} },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootStudio(page, s);

    // REAL token picker (both engines): pick "In 7 days" (+7d); the TOKEN
    // persists verbatim (resolution is config-dto's job, not the studio's).
    await canvasRender(page).locator('[data-component-type="DateQuestion"]').click();
    await openInspectorTab(page, "content");
    const minSelect = page.locator('[data-inspector-vdate="min"]');
    await expect(minSelect, "the Min token dropdown is present for a Date field").toBeVisible({ timeout: 4_000 });
    await minSelect.selectOption("+7d");
    await saveStudio(page);
    const dateNode = (await fetchSection(request, s.public_id)).content_json.components.find(
      (c) => c.question_id === "q_date",
    ) as { props?: { min?: unknown } };
    expect(dateNode.props?.min, "the +7d TOKEN (not a pre-resolved date) persists").toBe("+7d");

    // Garbage bounds UNAUTHORABLE (both engines): a raw POST with a non-date Min
    // is rejected 400 — never saved silently (the PC-A5 defect inverted).
    const garbage = await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `ACC Item5 garbage ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Garbage date",
        status: "active",
        content_json: {
          components: [{ type: "DateQuestion", question_id: "q_bad", internal_field: "dbad", props: { min: "whenever" } }],
        },
      },
    });
    expect(garbage.status(), "a garbage date bound must be rejected, not saved").toBe(400);
    expect(await garbage.text(), "the rejection explains the date-bound grammar").toContain("Date field must be a date");

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 5 live date enforcement needs chromium --host-resolver-rules; leadgen-p4b-validation pins the live +7d resolution. The studio token-picker + the API-400 garbage-bound assertions above run on BOTH engines.",
      )
    )
      return;

    // LIVE: the funnel enforces the CONCRETE resolved date (today+7) with the
    // exact message — never the literal "+7d" — and admits a date on/after it.
    const dateNext = await createNextSection(request);
    const seeded = await seedLiveFunnel(request, "item5", [s.id, dateNext.id]);
    const today = new Date();
    const iso = (dt: Date) => dt.toISOString().slice(0, 10);
    const min = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7));
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on this funnel's own first page (Date) at index 1 (was 0),
    // dateNext at index 2 (was 1).
    await passSharedPage(page);
    await liveSection(page, 1).locator("[data-lg-input]").first().fill(iso(today));
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "a date before the resolved min must block").toBe(1);
    const slot = liveSection(page, 1).locator('[data-lg-error-for="d"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText(iso(min));
    await expect(slot).not.toContainText("+7d");
    // A date comfortably on/after the resolved min advances (min+2d avoids any
    // day-boundary ambiguity between the test clock and the server's resolution).
    const after = new Date(min.getTime() + 2 * 86_400_000);
    await liveSection(page, 1).locator("[data-lg-input]").first().fill(iso(after));
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(2);
  });

  // =========================================================================
  // Item 6 — "If it's wrong, say so" proven
  // Register PC-6 (PC-A2) · deeper gate: leadgen-p4b-validation.spec.ts. Journey:
  // a custom email error_text with ZERO ValidationError node still renders live
  // on a format failure — because error slots exist by default. The canvas slot
  // (both engines) proves the zero-authoring slot; the live render proves the
  // custom text.
  // =========================================================================
  test('Item 6 — "if the answer is wrong, let me just say so" (custom error, zero ValidationError node)', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `ACC Item6 email ${uniq}`, [
      {
        type: "EmailInputQuestion",
        question_id: "q_email",
        internal_field: "email",
        required: true,
        props: { error_text: "If it is wrong, say so." },
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootStudio(page, s);
    // Zero-authoring error slot exists on the canvas (both engines): no
    // ValidationError node was authored, yet the field carries its own slot.
    await expect(frameOf(page).locator('[data-component-type="EmailInputQuestion"]')).toBeVisible();
    await expect(frameOf(page).locator('[data-lg-error-for="email"]'), "the email field owns an auto error slot (zero ValidationError authoring)").toHaveCount(1);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 6 live custom-error render needs chromium --host-resolver-rules; leadgen-p4b-validation pins the live custom-message render. The canvas auto-slot assertion above runs on BOTH engines.",
      )
    )
      return;

    // LIVE: a format failure surfaces the operator's OWN words in that slot.
    const seeded = await seedLiveFunnel(request, "item6", [s.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on this funnel's own first (and only) page at index 1.
    await passSharedPage(page);
    await liveSection(page, 1).locator("[data-lg-input]").first().fill("not-an-email");
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "an invalid email must block Continue").toBe(1);
    const slot = liveSection(page, 1).locator('[data-lg-error-for="email"]');
    await expect(slot).toBeVisible();
    await expect(slot).toHaveText("If it is wrong, say so.");
  });

  // =========================================================================
  // Item 7 — Number Step logic (the 502 trap; step on text fields)
  // Register PC-7 (PC-A3) · deeper gate: leadgen-p4b-validation.spec.ts. Journey:
  // a step:5 number field rejects 502 LIVE with the nearest-valid message; a
  // text field carrying step is UNAUTHORABLE (API 400 — the Accept-swap cleans
  // stale props), proven on both engines.
  // =========================================================================
  test('Item 7 — "502 should be rejected to the nearest valid step, and step must not linger on text" (PC-7)', async ({
    page,
    request,
    browserName,
  }) => {
    // step absent on a text field (both engines): an EmailInputQuestion carrying
    // props.step is rejected 400 — a text field has no step (swap cleans it).
    const badStep = await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `ACC Item7 badstep ${uniq}`,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Step on text",
        status: "active",
        content_json: {
          components: [{ type: "EmailInputQuestion", question_id: "q_e", internal_field: "e7", props: { step: 5 } }],
        },
      },
    });
    expect(badStep.status(), "step on a text field must be rejected").toBe(400);
    expect(await badStep.text(), "the rejection says step is numeric-only").toContain("step is only valid on Number");

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 7 live nearest-valid rejection needs chromium --host-resolver-rules; leadgen-p4b-validation pins the live step message. The step-on-text API-400 assertion above runs on BOTH engines.",
      )
    )
      return;

    // LIVE: min:1 step:5 max:1000 → 502 is off-grid → blocked with the exact
    // nearest-valid message.
    const num = await createStudioSection(request, `ACC Item7 number ${uniq}`, [
      { type: "NumberInputQuestion", question_id: "q_n", internal_field: "n", required: true, props: { min: 1, max: 1000, step: 5 } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    const seeded = await seedLiveFunnel(request, "item7", [num.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on this funnel's own first (and only) page at index 1.
    await passSharedPage(page);
    await liveSection(page, 1).locator("[data-lg-input]").first().fill("502");
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "502 is off the step grid and must block").toBe(1);
    const slot = liveSection(page, 1).locator('[data-lg-error-for="n"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText("Nearest valid values: 501 and 506");
  });

  // =========================================================================
  // Item 8 — Deletion: delete == removal, choice-level delete, undo, no phantoms
  // Register PC-8 (PC-A7) · deeper gate: leadgen-p4d-editor.gesture.spec.ts
  // (studio-only, both engines). Journey: select a component → Backspace removes
  // it with the anchored toast + working undo; a CHOICE Backspace deletes only
  // the choice; no-selection Backspace is a silent no-op (no phantom toast).
  // =========================================================================
  test('Item 8 — "Backspace should delete the thing, offer undo, and never fire a phantom toast" (Image7)', async ({
    page,
    request,
  }) => {
    const s = await createStudioSection(request, `ACC Item8 delete ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_make",
        internal_field: "car_make8",
        answer_type: "enum",
        choices: [
          { label: "Toyota", value: "toyota", analytics_id: "toyota" },
          { label: "Honda", value: "honda", analytics_id: "honda" },
        ],
      },
      // A sibling answer field so the Section stays valid after the group delete.
      { type: "TwoButtonYesNo", question_id: "q_keep", internal_field: "keep8", props: { yesLabel: "Yes", noLabel: "No" } },
    ]);
    await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
    // A choice/group delete must NEVER prompt a confirm (p4d contract); a
    // beforeunload on navigating away with unsaved edits is expected and accepted.
    page.on("dialog", (d) => {
      if (d.type() === "beforeunload") {
        void d.accept();
        return;
      }
      throw new Error(`unexpected dialog: ${d.message()}`);
    });
    const canvasSurface = page.locator("#lg-studio-canvas");

    // CHOICE-scope Backspace deletes ONLY the choice; the group + sibling survive.
    await canvasRender(page).locator('[data-lg-choice="toyota"]').click();
    await expect(page.locator("[data-scope-editing-name]")).toContainText("Answer choice");
    await canvasSurface.focus();
    await page.keyboard.press("Backspace");
    await expect(canvasRender(page).locator('[data-lg-choice="toyota"]')).toHaveCount(0);
    await expect(canvasRender(page).locator('[data-lg-choice="honda"]')).toHaveCount(1);
    await expect(canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]')).toHaveCount(1);

    // Anchored toast + WORKING undo restores the choice.
    const toast = page.locator("[data-studio-undo-toast]");
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("deleted");
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(canvasRender(page).locator('[data-lg-choice="toyota"]')).toBeVisible({ timeout: 5_000 });

    // GROUP-scope Backspace deletes the WHOLE group (delete == removal).
    await canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]').click();
    await expect(page.locator("[data-scope-editing-name]")).not.toContainText("Answer choice");
    await canvasSurface.focus();
    await page.keyboard.press("Backspace");
    await expect(canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]')).toHaveCount(0);
    await expect(page.locator("[data-studio-undo-toast]")).toContainText("deleted");

    // MODEL removal (not just the canvas): save + refetch → the group is gone
    // from the persisted content; the headline + sibling survive.
    await saveStudioAwaitOk(page, s.public_id);
    const afterDelete = (await fetchSection(request, s.public_id)).content_json.components;
    expect(afterDelete.some((c) => c.type === "ButtonAnswerGroup"), "the deleted group is gone from the persisted model").toBe(false);
    expect(afterDelete.some((c) => c.type === "TwoButtonYesNo"), "the sibling survives in the persisted model").toBe(true);

    // NO PHANTOM TOAST: with nothing selected, Backspace is a silent no-op.
    const s2 = await createStudioSection(request, `ACC Item8 noop ${uniq}`, [
      { type: "TwoButtonYesNo", question_id: "q1", internal_field: "a18", props: { yesLabel: "Yes", noLabel: "No" } },
    ]);
    await page.goto(`/admin/leadgen/sections/${s2.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const surface2 = page.locator("#lg-studio-canvas");
    await canvasRender(page).locator('[data-component-type="TwoButtonYesNo"]').click();
    await expect(canvasRender(page).locator(".studio-selected-node")).toHaveCount(1);
    await surface2.focus();
    await page.keyboard.press("Escape");
    await expect(canvasRender(page).locator(".studio-selected-node")).toHaveCount(0);
    await surface2.focus();
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    await expect(page.locator("[data-studio-undo-toast]"), "no selection → no phantom toast").toHaveCount(0);
    await expect(canvasRender(page).locator('[data-component-type="TwoButtonYesNo"]')).toHaveCount(1);
  });

  // =========================================================================
  // Item 9 — "New Section" overlaps the button (Image8)
  // Register PC-9 · deeper gate: leadgen-p1c-editor-chrome.spec.ts. Journey
  // (admin UI, both engines): the create-flow pubid badge CLEARS the studio
  // topbar + back link at 1280 AND 1600 — no overlap, still a visible affordance.
  // =========================================================================
  test('Item 9 — "the New Section badge overlaps the top controls" (Image8, no overlap at 1280/1600)', async ({ page }) => {
    interface Rect { x: number; y: number; width: number; height: number }
    const rectsOverlap = (a: Rect, b: Rect): boolean =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const boxOf = async (selector: string): Promise<Rect> => {
      const loc = page.locator(selector).first();
      await expect(loc, `${selector} must render`).toBeVisible({ timeout: 15_000 });
      const box = await loc.boundingBox();
      expect(box, `${selector} must have a real bounding box`).not.toBeNull();
      return box as Rect;
    };
    for (const width of [1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/leadgen/sections/new", { waitUntil: "domcontentloaded" });
      const badge = await boxOf(".lg-editor-pubid");
      const topbar = await boxOf("[data-studio-topbar]");
      const backLink = await boxOf(".studio-back");
      expect(rectsOverlap(badge, topbar), `@${width}: badge must not overlap the topbar`).toBe(false);
      expect(rectsOverlap(badge, backLink), `@${width}: badge must not overlap the back link`).toBe(false);
      expect(badge.width, `@${width}: badge is a visible affordance`).toBeGreaterThan(0);
      expect(badge.height, `@${width}: badge is a visible affordance`).toBeGreaterThan(0);
    }
  });

  // =========================================================================
  // Item 10 — Multi-question grid with defaults (Image9 vs 10)
  // Register PC-10 (decision D2).
  //
  // RETIRED (LeadGen Rework §10, own-hand-verified ui-section-studio.ts:2691-
  // 2696): this item used to author a row through the REAL rows editor
  // (data-mqg-rows-block / data-mqg-row / data-mqg-custom-choices /
  // data-mqg-add-row) and re-check studio-canvas parity afterward — that
  // whole editor panel is intentionally removed ("the MultiQuestionGrid
  // Sub-questions (rows) editor block is removed with the grid rows-editor.
  // The §4.1 palette starter inserts independent components instead.").
  // populateMqgRows/collectMqgRows are now no-ops (their [data-mqg-rows] host
  // is gone), left in place only until P5's orphan sweep. Replacement
  // authoring coverage: leadgen-rework-p2-studio.gesture.spec.ts's test (d)
  // (the §4.1 "Questions on one screen" starter, the new authoring path);
  // leadgen-rework-matrix.test.ts's §6.2 capability matrix. Replacement
  // canvas/render-structure + auction-pipeline coverage (byte-equivalent to
  // what the deleted reload-parity block checked, proven at the render-
  // function/schema layer instead of a live browser): test/leadgen-p5-multi-
  // question-grid.test.ts's "render structure" and "defaults record + the
  // normalize→payload round-trip" describe blocks.
  //
  // STILL LIVE (own-hand-verified ui-section-studio.ts:6600 "MultiQuestion
  // Grid STAYS — renderMultiQuestion..."): the catalog type + its presets
  // render survive until P5, so a MultiQuestionGrid authored directly via
  // content_json (bypassing the retired editor — exactly how the live/
  // auction leg below already worked) still renders and behaves correctly on
  // a live funnel. That backward-compat behavior is still-live, not retired,
  // so it is KEPT below: defaults pre-select, per-row required blocks, a
  // different pill updates, and THE AUCTION LEG — per-row answers arriving in
  // the live /lg/auction request (the R1 real-POST pattern). Both legs are
  // chromium-only (dynamic *.e2e.test host); on firefox this item now records
  // only the liveLegChromiumOnly skip annotation below and asserts nothing
  // (the both-engine assertions it used to run belonged entirely to the
  // retired rows-editor authoring above).
  // =========================================================================
  test('Item 10 — "a multi-question grid with default answers, like Homeowner/Married/Gender" (Image9)', async ({
    page,
    request,
    browserName,
  }) => {
    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10 live grid behavior + the /lg/auction leg need chromium --host-resolver-rules; test/leadgen-p5-multi-question-grid.test.ts pins the deterministic render-structure + auction pipeline (both engines, no browser needed). This item's own both-engine authoring assertions were retired with the rows editor (§10) — see the header comment above — so nothing runs here on firefox beyond this annotation.",
      )
    )
      return;

    // LIVE behavior: the FULL Image9 grid (Gender = Male/Female per-row override
    // included via the component's config path) with Homeowner REQUIRED but
    // UN-defaulted → defaults pre-select (incl. Gender male), per-row required
    // blocks, a different pill updates, and answering the required row advances.
    const liveGrid = await createStudioSection(request, `ACC Item10 live grid ${uniq}`, [
      {
        type: "MultiQuestionGrid",
        question_id: "q_g",
        choices: YESNO,
        props: {
          rows: [
            { label: "Homeowner", internal_field: "homeowner", required: true },
            { label: "Married", internal_field: "married", default: "no" },
            {
              label: "Gender",
              internal_field: "gender",
              default: "male",
              choices: [
                { label: "Male", value: "male", analytics_id: "male" },
                { label: "Female", value: "female", analytics_id: "female" },
              ],
            },
            { label: "Military Affiliation", internal_field: "military", default: "no" },
          ],
        },
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    const gridNext = await createNextSection(request);
    const seededLive = await seedLiveFunnel(request, "item10", [liveGrid.id, gridNext.id]);
    await page.goto(shellUrl(seededLive), { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on this funnel's own first page (the grid) at index 1 (was
    // 0), gridNext at index 2 (was 1).
    await passSharedPage(page);
    // Defaults pre-selected live for the defaulted rows — incl. Gender's Male/
    // Female per-row override (the Image9 composition, rendered live).
    await expect(liveSection(page, 1).locator('[data-lg-question="q_g::married"] [data-lg-choice="no"]')).toHaveClass(/lg-selected/);
    await expect(liveSection(page, 1).locator('[data-lg-question="q_g::gender"] [data-lg-choice="male"]')).toHaveClass(/lg-selected/);
    // Per-row required blocks: the un-answered required Homeowner row stops Continue.
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "an unanswered per-row required must block").toBe(1);
    await expect(liveSection(page, 1).locator('[data-lg-error-for="homeowner"]')).toBeVisible();
    // A DIFFERENT pill updates the answer (Married no → yes).
    await liveSection(page, 1).locator('[data-lg-question="q_g::married"] [data-lg-choice="yes"]').click();
    await expect(liveSection(page, 1).locator('[data-lg-question="q_g::married"] [data-lg-choice="yes"]')).toHaveClass(/lg-selected/);
    await expect(liveSection(page, 1).locator('[data-lg-question="q_g::married"] [data-lg-choice="no"]')).not.toHaveClass(/lg-selected/);
    // Answer the required Homeowner row → the grid now advances.
    await liveSection(page, 1).locator('[data-lg-question="q_g::homeowner"] [data-lg-choice="yes"]').click();
    await liveSection(page, 1).locator("[data-lg-continue]").first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(2);

    // THE AUCTION LEG (R1 real-POST): reuse the proven filling offer+auction
    // funnel (leadgen-fix-p1-seed) and APPEND an all-defaulted grid (grid-scoped
    // fields, no collision with s1 homeowner / s2 zip) as the LAST section. The
    // grid's per-row defaults ride the answer store and ARRIVE in the live
    // /lg/auction request context — a ZERO-CLICK advance past the grid (defaults
    // satisfy the required row) fires the auction.
    const auctCtx = await playwrightRequest.newContext({ baseURL: `http://127.0.0.1:${PORT}`, extraHTTPHeaders: {} });
    const seededAuct = await seedFixP1Funnel(auctCtx, { hostPrefix: "acc-item10-auct", slug: "acc-item10-auct" });
    const mqgAuct = await createStudioSection(auctCtx, `ACC Item10 auction grid ${uniq}`, [
      {
        type: "MultiQuestionGrid",
        question_id: "q_grid",
        choices: YESNO,
        props: {
          rows: [
            { label: "Homeowner", internal_field: "g_homeowner", default: "yes", required: true },
            { label: "Married", internal_field: "g_married", default: "no" },
            {
              label: "Gender",
              internal_field: "g_gender",
              default: "male",
              choices: [
                { label: "Male", value: "male", analytics_id: "male" },
                { label: "Female", value: "female", analytics_id: "female" },
              ],
            },
            { label: "Military Affiliation", internal_field: "g_military", default: "no" },
          ],
        },
      },
      { type: "ContinueButton", question_id: "q_grid_cont", props: { label: "See my quotes" } },
    ]);
    await json(
      await auctCtx.put(`${LG_API}/variants/${seededAuct.variantId}`, {
        data: {
          auction_id: seededAuct.auctionId,
          sections: [
            { section_id: seededAuct.sectionOneId, position: 0 },
            { section_id: seededAuct.sectionTwoId, position: 1 },
            { section_id: mqgAuct.id, position: 2 },
          ],
        },
      }),
      "append MQG to auction variant",
    );
    // Re-activate (idempotent) so the funnel serves the 3-section order.
    await json(
      await auctCtx.put(`${LG_API}/quotes/${seededAuct.quotePublicId}/activation/${seededAuct.siteId}`, {
        data: { enabled: true, slug: seededAuct.slug },
      }),
      "re-activate auction quote",
    );
    await auctCtx.dispose();

    await page.goto(`http://${seededAuct.host}:${PORT}/lg/${seededAuct.slug}`, { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedFixP1Funnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on s1 (homeowner) at index 1 (was 0), s2 (zip) at index 2
    // (was 1), the appended MQG grid at index 3 (was 2).
    await passSharedPage(page);
    // s1 homeowner (default yes) → auto-advance to s2.
    await liveSection(page, 1).locator('[data-lg-choice="true"]').click();
    await expect(liveSection(page, 2)).toBeVisible();
    // s2 zip + dependent → Continue advances to the grid (NOT the auction yet).
    await liveSection(page, 2).locator("[data-lg-input]").first().fill("90210");
    await page.locator('[data-lg-question="q_prior"] [data-lg-choice="insured"]').click();
    await liveSection(page, 2).locator("[data-lg-continue]").first().click();
    await expect(liveSection(page, 3)).toBeVisible();
    // The grid: defaults satisfy the required row → a ZERO-CLICK Continue fires
    // the /lg/auction POST; its answers carry every grid row.
    const [auctionReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/lg/auction") && r.method() === "POST", { timeout: 20_000 }),
      liveSection(page, 3).locator("[data-lg-continue]").first().click(),
    ]);
    const body = auctionReq.postDataJSON() as { answers: Record<string, { value: unknown; answer_source: string }> };
    expect(body.answers["g_homeowner"], "the grid Homeowner default arrives in the auction request").toEqual({
      value: "yes",
      answer_source: "default_applied",
    });
    expect(body.answers["g_married"]).toEqual({ value: "no", answer_source: "default_applied" });
    expect(body.answers["g_gender"]).toEqual({ value: "male", answer_source: "default_applied" });
    expect(body.answers["g_military"]).toEqual({ value: "no", answer_source: "default_applied" });
  });

  // =========================================================================
  // Item 11 — Cards: layout control, responsive, icon library + sizes (Image11)
  // Register PC-11 · deeper gates: leadgen-p1-geometry (48px icons + columns +
  // responsive) + leadgen-p2a-element-freedom (per-element style + off-theme
  // badge). Journey: an IconCardAnswerGrid with 48px Tabler icons + columns:3;
  // author a per-choice orange (accent role) + an off-theme badge through the
  // REAL popover (both engines); LIVE the styles render exactly + mobile 375
  // collapses to one column with no horizontal scroll.
  // =========================================================================
  test('Item 11 — "cards need real layout control, 48px icons, and a responsive collapse" (Image11)', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `ACC Item11 cards ${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "IconCardAnswerGrid",
        question_id: "q_cards",
        internal_field: "biz11",
        answer_type: "enum",
        props: { columns: 3 },
        choices: [
          { label: "Allow", value: "allow", analytics_id: "al", icon: "home" },
          { label: "Warn", value: "warn", analytics_id: "wa", icon: "shield" },
          { label: "Deny", value: "deny", analytics_id: "de", icon: "car" },
        ],
      },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await bootStudio(page, s);
    const frame = frameOf(page);
    await expect(frame.locator('[data-question-id="q_cards"] .lg-card').first()).toBeVisible({ timeout: 20_000 });

    // Per-choice style via the REAL popover (both engines): Allow → accent role
    // (the operator's orange); a theme role is never "off theme" (badge hidden).
    await frame.locator('[data-lg-choice="allow"]').click();
    const rows = page.locator("[data-inspector-choices] [data-choice-row]");
    await expect(rows).toHaveCount(3);
    await rows.nth(0).locator("[data-choice-style-toggle]").click();
    const allowPanel = rows.nth(0).locator("[data-choice-style-panel]");
    await expect(allowPanel).toBeVisible();
    await allowPanel.locator('[data-choice-style-axis="color"] [data-choice-role-swatch="accent"]').click();
    await expect(allowPanel.locator('[data-choice-style-axis="color"] [data-choice-role-swatch="accent"]')).toHaveClass(/active/);
    await expect(rows.nth(0).locator("[data-choice-offtheme-badge]")).toBeHidden();

    // Warn → a deliberate OFF-THEME hex: the Off-theme badge SHOWS (diff-only).
    await frame.locator('[data-lg-choice="warn"]').click();
    const warnRows = page.locator("[data-inspector-choices] [data-choice-row]");
    await warnRows.nth(1).locator("[data-choice-style-toggle]").click();
    const warnPanel = warnRows.nth(1).locator("[data-choice-style-panel]");
    await expect(warnPanel).toBeVisible();
    await warnPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]').fill(OFF_THEME_HEX);
    await warnPanel.locator('[data-choice-style-axis="color"] [data-choice-hex-input]').blur();
    await expect(warnRows.nth(1).locator("[data-choice-offtheme-badge]")).toBeVisible();
    await expect(warnRows.nth(1).locator("[data-choice-offtheme-badge]")).toHaveText("Off theme");
    await saveStudio(page);

    // 48px Tabler icons + columns:3 on the canvas (both engines).
    const canvasCards = await page.evaluate(() => {
      const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
      if (!doc) return null;
      const grid = doc.querySelector('[data-question-id="q_cards"]');
      const view = doc.defaultView!;
      const svg = doc.querySelector('[data-question-id="q_cards"] .lg-card-icon svg');
      const r = svg ? svg.getBoundingClientRect() : null;
      return {
        tracks: grid ? view.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0,
        iconW: r ? r.width : 0,
        iconH: r ? r.height : 0,
      };
    });
    expect(canvasCards, "canvas cards measurable").not.toBeNull();
    expect(canvasCards!.tracks, "authored columns:3 → 3 grid tracks").toBe(3);
    expect(Math.abs(canvasCards!.iconW - 48), `icon width ${canvasCards!.iconW} == 48`).toBeLessThanOrEqual(1);
    expect(Math.abs(canvasCards!.iconH - 48), `icon height ${canvasCards!.iconH} == 48`).toBeLessThanOrEqual(1);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 11 live card render + mobile collapse need chromium --host-resolver-rules; leadgen-p1-geometry pins live icon/column/responsive geometry and leadgen-p2a-element-freedom pins per-element paint — both cross-engine for their studio legs. The popover + canvas assertions above run on BOTH engines.",
      )
    )
      return;

    // LIVE: the authored orange renders EXACTLY, columns:3 holds, 48px icons.
    const seeded = await seedLiveFunnel(request, "item11", [s.id]);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now renders first — pass it before waiting on q_cards.
    await ready(page);
    await passSharedPage(page);
    await expect(page.locator('[data-question-id="q_cards"] .lg-card').first()).toBeVisible({ timeout: 15_000 });
    const liveCards = await page.evaluate(() => {
      const grid = document.querySelector('[data-question-id="q_cards"]');
      const svg = document.querySelector('[data-question-id="q_cards"] .lg-card-icon svg');
      const allow = document.querySelector('[data-lg-choice="allow"]');
      const r = svg ? svg.getBoundingClientRect() : null;
      return {
        tracks: grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0,
        iconW: r ? r.width : 0,
        allowBg: allow ? getComputedStyle(allow).backgroundColor : "",
      };
    });
    expect(liveCards.tracks, "live columns:3").toBe(3);
    expect(Math.abs(liveCards.iconW - 48), `live icon width ${liveCards.iconW} == 48`).toBeLessThanOrEqual(1);
    expect(liveCards.allowBg, `the authored orange (${ACCENT_HEX}) renders exactly live`).toBe(ACCENT_RGB);

    // Mobile 375: cards collapse to ONE column, no horizontal scroll.
    await page.setViewportSize({ width: 375, height: 1400 });
    await page.waitForTimeout(250);
    const mobile = await page.evaluate(() => {
      const grid = document.querySelector('[data-question-id="q_cards"]');
      return {
        tracks: grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0,
        scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(mobile.tracks, "mobile: cards collapse to 1 column").toBe(1);
    expect(mobile.scrollWidth, `mobile: no horizontal scroll (${mobile.scrollWidth} ≤ ${mobile.innerWidth})`).toBeLessThanOrEqual(mobile.innerWidth + 1);
  });

  // =========================================================================
  // Item 12 — Rules: names not ids; show/hide; conditional Continue (Image14)
  // Register PC-12 · deeper gate: leadgen-p4c-rules.gesture.spec.ts. Journey:
  // through the REAL sentence builder, "Show Carrier when Are you insured? is
  // Yes" (human NAMES, never ids) — the boolean-picker case that previously
  // never fired live (leg 4 fix). Studio authoring both engines; LIVE Carrier
  // hides then reveals on a real Yes click, and a conditional Continue stays
  // hidden until the trigger then shows + advances.
  // =========================================================================
  test('Item 12 — "Show Carrier when Are you insured? is Yes — by name, and it must actually reveal" (Image14)', async ({
    page,
    request,
    browserName,
  }) => {
    const s = await createStudioSection(request, `ACC Item12 rules ${uniq}`, [
      { type: "TwoButtonYesNo", question_id: "q_ins", internal_field: "currently_insured", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      { type: "FreeTextQuestion", question_id: "q_carrier", internal_field: "carrier", answer_type: "string", props: { placeholder: "Which carrier?" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ], { headline_text: "Are you insured?" });
    await bootStudio(page, s);

    // REAL sentence builder (both engines): select Carrier → Rules tab → add a
    // Show-if. The "when" options speak HUMAN names (the section headline for its
    // first field), never the raw internal_field id; the sentence is human too.
    await frameOf(page).locator('#lg-studio-canvas-render [data-question-id="q_carrier"]').click();
    await openInspectorTab(page, "rules");
    await page.locator("[data-rules-add-condition]").click();
    const whenSel = page.locator('[data-inspector-cond="when"]');
    const options = await whenSel.locator("option").evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, text: (e.textContent || "").trim() })),
    );
    const insuredOpt = options.find((o) => o.value === "currently_insured");
    expect(insuredOpt, `options were: ${JSON.stringify(options)}`).toBeDefined();
    expect(insuredOpt!.text, "the picker shows the human name, never the id").toBe("Are you insured?");
    expect(insuredOpt!.text).not.toBe("currently_insured");
    await whenSel.selectOption("currently_insured");
    const boolValue = page.locator('[data-inspector-cond="value-bool"]');
    await expect(boolValue).toBeVisible();
    await boolValue.selectOption("true");
    await expect(page.locator("[data-cond-sentence]")).toHaveText("Show this question when Are you insured? is Yes");

    // Conditional Continue (both engines): author on the REAL Continue panel.
    await frameOf(page).locator('#lg-studio-canvas-render [data-component-type="ContinueButton"]').click();
    await openInspectorTab(page, "style");
    await page.locator("[data-continuecond-add]").click();
    const contWhen = page.locator('[data-inspector-continuecond="when"]');
    await expect(contWhen).toBeVisible();
    await contWhen.selectOption("currently_insured");
    await page.locator('[data-inspector-continuecond="value-bool"]').selectOption("true");
    await expect(page.locator("[data-continuecond-sentence]")).toHaveText("Show Continue when Are you insured? is Yes");

    // The STORED contract is unchanged: internal_field value + a REAL boolean.
    const [patchRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/sections/${s.public_id}`) && r.request().method() === "PATCH"),
      page.locator("#lg-section-save").click(),
    ]);
    expect(patchRes.ok(), await patchRes.text()).toBe(true);
    const detail = await fetchSection(request, s.public_id);
    const carrier = detail.content_json.components.find((c) => c.question_id === "q_carrier") as {
      conditional?: { when: string; op: string; value: unknown };
    };
    expect(carrier.conditional, "the Show-if stores the id + a real boolean").toEqual({ when: "currently_insured", op: "eq", value: true });
    expect(detail.content_json.continue_visible_when).toEqual({ when: "currently_insured", op: "eq", value: true });

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 12 live reveal needs chromium --host-resolver-rules; leadgen-p4c-rules.gesture.spec.ts pins the studio authoring on BOTH engines (legs 1/2) and the live boolean-trigger reveal on chromium (leg 4). The sentence-builder assertions above run on BOTH engines.",
      )
    )
      return;

    // LIVE (the previously-never-firing boolean-picker class): Carrier + Continue
    // hidden until "Are you insured?" is answered Yes with a REAL click.
    const rulesNext = await createNextSection(request);
    const seeded = await seedLiveFunnel(request, "item12", [s.id, rulesNext.id]);
    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    // LeadGen Rework §4.3-1 (P1, own-hand-verified): seedLiveFunnel's trivial
    // shared page now occupies section_index 0 — passSharedPage advances past
    // it, landing on this funnel's own first page (s) at index 1 (was 0),
    // rulesNext at index 2 (was 1).
    await passSharedPage(page);
    const carrierEl = page.locator('[data-lg-question="q_carrier"]');
    const cont = liveSection(page, 1).locator("[data-lg-continue]").first();
    await expect(carrierEl, "Carrier is hidden until the trigger is Yes").toBeHidden();
    await expect(cont, "conditional Continue is hidden until the trigger is Yes").toBeHidden();
    // "No" keeps both hidden.
    await liveSection(page, 1).locator('[data-lg-question="q_ins"] [data-lg-choice="false"]').click();
    await page.waitForTimeout(200);
    await expect(carrierEl).toBeHidden();
    // A REAL "Yes" click reveals Carrier AND the conditional Continue.
    await liveSection(page, 1).locator('[data-lg-question="q_ins"] [data-lg-choice="true"]').click();
    await expect(carrierEl, "Carrier reveals on a live Yes").toBeVisible({ timeout: 3_000 });
    await expect(cont, "the conditional Continue reveals on a live Yes").toBeVisible({ timeout: 3_000 });
    // The revealed Continue genuinely advances the funnel.
    await cont.click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(2);
  });
});
