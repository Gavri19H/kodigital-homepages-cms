// LeadGen R2 · P7 owner-reported defects — DRIVE.
//
// Finding 1 (SOURCE-OF-TRUTH A.2, "the 'J' element, I don't see it in the
//   Quotes"): the footer funnel-layout tile. Legs 1..5 below drive the tile on
//   a LIVE instance and check A.2's five named sub-clauses one by one —
//   free text (rich toolbar) / links to legal pages from the "pages" tab that
//   the user is choosing / Logo / company details / different color, font and
//   sizes than the main template — so "substance vs naming" is answered by
//   measurement, not by reading the source. Leg 6 is the naming itself.
//
// Finding 2 (§14.2 publish chip): "Blocked (2 errors)" names no reason. Leg 7
//   reproduces the owner's exact quote shape (Insurance / Car / draft / no
//   sections / no logo) through the REAL admin API and reads the REAL preflight;
//   leg 8 drives the head bar and asserts the reasons are readable there with
//   ZERO extra clicks.
//
// Run (worktree-isolated, this worktree's port):
//   cd api && PW_PORT=8901 npx playwright test test-ui/leadgen-r2p7-owner-drive.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { LG_API, ORIGIN, REAL_CHROME_UA, json } from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p7-owner";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;

// PHASE=before captures the pre-fix state, PHASE=after the post-fix state.
const PHASE = process.env.PHASE === "before" ? "before" : "after";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  appendFileSync(MEASUREMENTS, `\n===== ${PHASE} run ${new Date().toISOString()} =====\n`);
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

function note(line: string): void {
  appendFileSync(MEASUREMENTS, `${line}\n`);
}

// E6: the same state at 1280 AND 375, with the 375 overflow measured.
async function shot(page: Page, name: string): Promise<void> {
  for (const w of [1280, 375]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${EVIDENCE_DIR}/${PHASE}-${name}-${w}.png`, fullPage: false });
    const over = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    note(`[shot] ${PHASE}-${name}-${w}: scrollWidth=${over.sw} innerWidth=${over.iw} overflow=${over.sw > over.iw}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

// The fixture quote seeded by `npm run seed:leadgen-fixture` (activated, has a
// site with 5 real legal pages) — resolved by name so a re-seed cannot stale it.
async function fixtureQuoteId(): Promise<string> {
  const list = await json<{ items: Array<{ public_id: string; quote_name: string }> }>(
    await apiCtx.get(`${LG_API}/quotes`),
    "quotes list",
  );
  const q = list.items.find((x) => x.quote_name.includes("R2Fix")) ?? list.items[0];
  if (q === undefined) throw new Error("no seeded quote");
  return q.public_id;
}

async function openTemplatesFooterTile(page: Page, quoteId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quoteId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-board]")).toBeVisible({ timeout: 20_000 });
  await page.locator('.lg-qtab[data-tab="templates"]').click();
  await expect(page.locator('[data-panel="templates"]')).toHaveClass(/active/);
  await page.locator('[data-tplbox-pick="footer"]').click();
  await expect(page.locator('[data-tplbox-panel="footer"]')).toHaveClass(/active/);
}

test.describe("Finding 1 — A.2 sub-clauses, driven on the footer tile", () => {
  let quoteId = "";
  test.beforeAll(async () => {
    quoteId = await fixtureQuoteId();
    note(`[fixture] quote=${quoteId}`);
  });

  test("1 · free text with a REAL rich toolbar (bold/italic/link actually mutate the stored html)", async ({ page }) => {
    await openTemplatesFooterTile(page, quoteId);
    await page.locator('[data-tplbox-add="footer.blocks"]').click();
    const row = page.locator("[data-footer-block-row]").last();
    await row.locator("[data-footer-block-type]").selectOption("about_paragraph");
    const ta = row.locator("[data-footer-block-text]");
    await ta.fill("Acme Insurance Services");
    // select "Acme" and press the toolbar's Bold
    await ta.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(0, 4));
    const toolbar = row.locator("[data-footer-block-toolbar]");
    await expect(toolbar).toBeVisible();
    const btns = await toolbar.locator("[data-footer-fmt]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-footer-fmt")),
    );
    note(`[A.2-1] toolbar buttons = ${JSON.stringify(btns)}`);
    await toolbar.locator('[data-footer-fmt="bold"]').click();
    const after = await ta.inputValue();
    note(`[A.2-1] textarea after Bold = ${JSON.stringify(after)}`);
    expect(after).toContain("<strong>Acme</strong>");
    await shot(page, "f1-freetext-toolbar");
  });

  test("2 · legal-page picker fed from the Pages tab, operator CHOOSES which", async ({ page }) => {
    await openTemplatesFooterTile(page, quoteId);
    await page.locator('[data-tplbox-add="footer.blocks"]').click();
    const row = page.locator("[data-footer-block-row]").last();
    await row.locator("[data-footer-block-type]").selectOption("link_row");
    await row.locator("[data-footer-block-linksource]").selectOption("picked");
    const load = row.locator("[data-footer-picks-load]");
    await expect(load).toBeVisible();
    await load.click();
    const rows = row.locator("[data-footer-pick-row]");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const titles = await rows.locator("[data-footer-pick-title]").allInnerTexts();
    note(`[A.2-2] picker rows loaded from the Pages tab = ${rows ? titles.length : 0}: ${JSON.stringify(titles)}`);
    expect(titles.length).toBeGreaterThan(0);
    // the operator CHOOSES: tick exactly one and confirm only that one is checked
    await rows.nth(0).locator("[data-footer-pick-checked]").check();
    const checked = await rows.locator("[data-footer-pick-checked]").evaluateAll(
      (els) => els.filter((e) => (e as HTMLInputElement).checked).length,
    );
    note(`[A.2-2] checked after choosing one = ${checked}`);
    expect(checked).toBe(1);
    await shot(page, "f1-legal-picker");
  });

  test("3+4 · Logo block and company-details block exist as choosable footer block types", async ({ page }) => {
    await openTemplatesFooterTile(page, quoteId);
    await page.locator('[data-tplbox-add="footer.blocks"]').click();
    const row = page.locator("[data-footer-block-row]").last();
    const types = await row.locator("[data-footer-block-type] option").evaluateAll((els) =>
      els.map((e) => `${e.getAttribute("value")}=${e.textContent}`),
    );
    note(`[A.2-3/4] footer block types = ${JSON.stringify(types)}`);
    expect(types.some((t) => t.startsWith("logo="))).toBe(true);
    // R2 P8 stale-pin re-mint: at this test's own baseline the option label
    // was "About paragraph / company details" (lowercase, matched by this
    // check); R2 P8 S4.2 FIX ROUND F1 (§7 N17) — commit cddb77a0 —
    // deliberately renamed it to the single, Title-Case name "Company
    // details" (docs/leadgen/r2/evidence/p8/review-p8-4/REVIEW.md finding
    // N17, PERFECT: "one option, 'Company details'"), so a case-sensitive
    // lowercase substring check no longer matches. templates.ts:514.
    expect(types.some((t) => t.includes("Company details"))).toBe(true);
    // Logo: site-or-manual source + media/url/alt fields
    await row.locator("[data-footer-block-type]").selectOption("logo");
    const src = row.locator("[data-footer-block-logosource]");
    await expect(src).toBeVisible();
    const srcOpts = await src.locator("option").evaluateAll((els) => els.map((e) => e.getAttribute("value")));
    note(`[A.2-3] logo sources = ${JSON.stringify(srcOpts)}`);
    await shot(page, "f1-logo-block");
  });

  test("5 · independent colour + font + size, and they reach the RENDERED page differently from the main template", async ({ page }) => {
    await openTemplatesFooterTile(page, quoteId);
    const panel = page.locator('[data-tplbox-panel="footer"]');
    // colour: 3 role strips (background / text / links) — same picker widget the
    // rest of the tiles use, scoped to footer.* keys.
    for (const k of ["footer.palette_scope.background", "footer.palette_scope.text", "footer.palette_scope.link"]) {
      await expect(panel.locator(`[data-role-strip="${k}"]`), `colour control ${k}`).toHaveCount(1);
    }
    // font + size: two selects keyed to footer.typography_scope.*
    for (const k of ["footer.typography_scope.font_family", "footer.typography_scope.size"]) {
      await expect(panel.locator(`[data-frame-key="${k}"]`), `typography control ${k}`).toHaveCount(1);
    }
    const fonts = await panel
      .locator('[data-frame-key="footer.typography_scope.font_family"] option')
      .evaluateAll((els) => els.map((e) => e.getAttribute("value")));
    const sizes = await panel
      .locator('[data-frame-key="footer.typography_scope.size"] option')
      .evaluateAll((els) => els.map((e) => e.getAttribute("value")));
    note(`[A.2-5] colour strips=3 fontOptions=${JSON.stringify(fonts)} sizeOptions=${JSON.stringify(sizes)}`);

    // INDEPENDENCE proven through the REAL preview renderer, not the editor:
    // the footer's own colour/font/size land as footer-scoped custom properties
    // that the main template's body does not share.
    const preview = await apiCtx.post(`${LG_API}/variants/${await firstVariantId(quoteId)}/preview`, {
      data: {
        draft_frame_config: {
          footer: {
            enabled: true,
            blocks: [{ type: "about_paragraph", text: "Acme Inc." }],
            palette_scope: { background: "brand_primary", text: "text_primary", link: "accent" },
            typography_scope: { font_family: "Newsreader", size: "xl" },
          },
        },
      },
    });
    expect(preview.status(), "preview accepted the footer-only palette/font/size").toBe(200);
    const body = (await preview.json()) as { preview: { css: string; html: string } };
    const html = `${body.preview.css}${body.preview.html}`;
    note(`[A.2-5] rendered .lg-frame-footer2 nodes = ${(html.match(/lg-frame-footer2/g) ?? []).length}`);
    const props = (html.match(/--lg-footer-(?:bg|fg|link|size|font):[^;"]+/g) ?? []).map((s) => s.slice(0, 60));
    note(`[A.2-5] rendered footer-scoped custom properties = ${JSON.stringify(props)}`);
    expect(props.some((p) => p.startsWith("--lg-footer-font:"))).toBe(true);
    expect(props.some((p) => p.startsWith("--lg-footer-bg:"))).toBe(true);
    expect(props.some((p) => p.startsWith("--lg-footer-size:"))).toBe(true);
  });

  test("6 · NAMING: the footer tile's letter and its position in the elements list", async ({ page }) => {
    await openTemplatesFooterTile(page, quoteId);
    const tiles = await page.locator("[data-tplbox-pick]").evaluateAll((els) =>
      els.map((e) => `${e.querySelector(".lg-tplbox-card-letter")?.textContent}:${e.getAttribute("data-tplbox-pick")}`),
    );
    note(`[A.2-6] elements list order/letters = ${JSON.stringify(tiles)}`);
    const heading = await page.locator('[data-tplbox-panel="footer"] h3').innerText();
    note(`[A.2-6] footer panel heading = ${JSON.stringify(heading)}`);
    // §5.4: exactly ONE footer tile, whatever it is lettered.
    expect(tiles.filter((t) => t.endsWith(":footer")).length).toBe(1);
    if (PHASE === "after") {
      expect(tiles[tiles.length - 1]).toBe("J:footer");
      expect(heading).toContain("J");
      // owner anchors that must NOT move
      expect(tiles.slice(0, 6)).toEqual(["A:background", "B:logo", "C:cta", "D:disclosure", "E:free_text", "F:brand_logos"]);
      expect(tiles).toContain("I:progress");
    }
    await shot(page, "f1-elements-list");
  });
});

async function firstVariantId(quoteId: string): Promise<string> {
  const q = await json<{ funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await apiCtx.get(`${LG_API}/quotes/${quoteId}`),
    "quote read",
  );
  return q.funnels[0]!.variants[0]!.public_id;
}

test.describe("Finding 2 — the two blockers behind 'Blocked (2 errors)'", () => {
  let ownerQuote = "";

  test("7 · the owner's exact quote shape reproduces EXACTLY two error-severity blockers", async () => {
    const created = await json<{ public_id: string }>(
      await apiCtx.post(`${LG_API}/quotes`, {
        data: { quote_name: `car ${Date.now()}`, activity: "insurance", verticals: ["car"] },
      }),
      "owner-shaped quote create",
    );
    ownerQuote = created.public_id;
    const act = await json<{ activation_preflight: { ok: boolean; blocks: unknown[]; problems: Array<{ severity: string; path: string; message: string }> } }>(
      await apiCtx.get(`${LG_API}/quotes/${ownerQuote}/activation`),
      "activation read",
    );
    const p = act.activation_preflight;
    const errs = p.problems.filter((x) => x.severity === "error");
    note(`[F2] quote=${ownerQuote} blocks=${p.blocks.length} problems=${p.problems.length} errors=${errs.length}`);
    for (const e of errs) note(`[F2]   error | ${e.path} | ${e.message}`);
    expect(p.blocks.length + errs.length).toBe(2);
  });

  test("8 · the head bar states the two reasons with ZERO extra clicks", async ({ page }) => {
    await page.goto(`/admin/leadgen/quotes/${ownerQuote}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-board]")).toBeVisible({ timeout: 20_000 });
    const chip = page.locator("#lg-publish-badge");
    await expect(chip).toBeVisible();
    note(`[F2] chip text = ${JSON.stringify(await chip.innerText())}`);
    const why = page.locator("#lg-publish-why");
    const whyCount = await why.count();
    note(`[F2] reasons element present = ${whyCount > 0}`);
    if (whyCount > 0) {
      const visible = await why.isVisible();
      const reasons = await why.locator("[data-publish-reason]").allInnerTexts();
      note(`[F2] reasons visible-without-clicking = ${visible}; reasons = ${JSON.stringify(reasons)}`);
    }
    await shot(page, "f2-publish-chip");
    if (PHASE === "after") {
      await expect(why).toBeVisible();
      const reasons = await why.locator("[data-publish-reason]").allInnerTexts();
      expect(reasons.length).toBe(2);
      expect(reasons.join(" ")).toContain("shared first page");
    }
  });
});
