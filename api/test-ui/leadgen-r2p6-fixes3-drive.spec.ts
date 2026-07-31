// LeadGen R2 · P6 terminal — fixes3 DRIVE: the two #11C follow-up findings.
//
// E1 (operator dead-end): "#lg-add-variant is always enabled but POST
//     /variants/:id/fork 409s unless a test is RUNNING, and the 409 sends the
//     operator to the tab they are already standing on." Same shape as the
//     owner-rejected ADJ-A9 (a requirement only learnable by triggering the
//     failure). Driven here as ONE real operator journey: the blocked tab is
//     read BEFORE any click, then the real Create -> Start -> Add variant path
//     is walked and the fork is proven to succeed.
//
// E2 (theme radius): the #11C drive read cardRadius 0px for BOTH a `sharp` and
//     a `round` funnel and left it UNVERIFIED. Traced here by MEASUREMENT, not
//     reading: stored theme -> emitted CSS custom properties -> painted
//     border-radius of every element the visitor actually sees.
//
// Run (worktree-isolated, this worktree's port):
//   cd api && PW_PORT=8901 npx playwright test test-ui/leadgen-r2p6-fixes3-drive.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import {
  LG_API,
  ORIGIN,
  REAL_CHROME_UA,
  createRoutingRule,
  json,
  ready,
  seedRoutingQuote,
  shellUrl,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p6/fixes3";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1440, height: 1000 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  appendFileSync(MEASUREMENTS, `\n===== run ${new Date().toISOString()} =====\n`);
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

function note(line: string): void {
  appendFileSync(MEASUREMENTS, `${line}\n`);
}

// E6: the SAME state at 1280 AND 375, with the 375 overflow measured.
async function shot(page: Page, name: string, focus?: string): Promise<void> {
  const prev = page.viewportSize() ?? { width: 1440, height: 1000 };
  const bring = async (): Promise<void> => {
    if (focus === undefined) return;
    const el = page.locator(focus).first();
    if ((await el.count()) > 0) await el.scrollIntoViewIfNeeded().catch(() => undefined);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await bring();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-1280.png`, fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await bring();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-375.png`, fullPage: false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(`${name} @375 scrollWidth=${m.sw} innerWidth=${m.iw} overflow=${m.sw > m.iw ? "YES" : "no"}`);
  await page.setViewportSize(prev);
  await page.waitForTimeout(150);
}

async function openAbTab(page: Page, quotePublicId: string, variantPublicId: string): Promise<void> {
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${quotePublicId}/edit?variant=${variantPublicId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-tab="ab"]').click();
  await expect(page.locator('[data-panel="ab"]')).toBeVisible({ timeout: 15_000 });
}

// ===========================================================================
// E1 — the A/B tab must state the "Add variant" precondition BEFORE the click,
//      and the real Create -> Start -> Add path must actually fork.
// ===========================================================================
test("E1 drive — blocked state is readable on the tab, and Create->Start->Add variant succeeds", async ({ page }) => {
  const u = uniqueTag("f3e1");
  const seed = await seedRoutingQuote(apiCtx, { tag: "p6f3e1", funnels: [{ headline: `fixes3 E1 ${u}`, field: "e1_a" }] });
  const variantId = seed.funnels[0]!.variant_public_id;

  // --- (1) BEFORE any click: the tab states what the button needs ----------
  await openAbTab(page, seed.quotePublicId, variantId);
  const addBtn = page.locator("#lg-add-variant");
  await expect(addBtn, "Add variant is disabled while no A/B test exists").toBeDisabled();
  await expect(addBtn).toHaveAttribute("data-add-variant-state", "no-test");
  const whyNoTest = page.locator("#lg-add-variant-why");
  await expect(whyNoTest, "the reason is VISIBLE on the tab, not hidden in a 409").toBeVisible();
  const orderLine = page.locator("[data-ab-order]");
  await expect(orderLine, "the required order is stated inline on the tab").toBeVisible();
  note(`E1 no-test  state=${await addBtn.getAttribute("data-add-variant-state")} disabled=${await addBtn.isDisabled()}`);
  note(`E1 no-test  reason = ${JSON.stringify((await whyNoTest.innerText()).replace(/\s+/g, " ").trim())}`);
  note(`E1 order    = ${JSON.stringify((await orderLine.innerText()).replace(/\s+/g, " ").trim())}`);
  await shot(page, "e1-blocked-no-test", "#lg-add-variant");

  // The server-side 409 the operator USED to have to trigger to learn the rule
  // (unchanged guard — the point is they no longer reach it blind).
  const forkNow = await apiCtx.post(`${LG_API}/variants/${variantId}/fork`);
  note(`E1 fork-before-any-test HTTP ${forkNow.status()} body=${(await forkNow.text()).slice(0, 220)}`);
  expect(forkNow.status(), "the server guard the UI now fronts").toBe(409);

  // --- (2) step 1 of the stated order: Create A/B test ----------------------
  await page.locator("#lg-create-experiment").click();
  // the island reloads the editor after the create — settle on the new document
  await expect(page.locator("[data-start-experiment]"), "the draft test now exists").toHaveCount(1, { timeout: 30_000 });
  await openAbTab(page, seed.quotePublicId, variantId);
  await expect(addBtn, "still blocked — the test exists but is not running").toBeDisabled();
  await expect(addBtn).toHaveAttribute("data-add-variant-state", "not-running");
  note(`E1 not-running reason = ${JSON.stringify((await page.locator("#lg-add-variant-why").innerText()).replace(/\s+/g, " ").trim())}`);
  await shot(page, "e1-blocked-not-running", "#lg-add-variant");

  // --- (3) step 2: Start A/B test -> the control unblocks -------------------
  await page.locator("[data-start-experiment]").click();
  await expect(page.locator("[data-stop-experiment]"), "the test is now RUNNING").toHaveCount(1, { timeout: 30_000 });
  await openAbTab(page, seed.quotePublicId, variantId);
  await expect(addBtn, "a running test is exactly what the tab said was needed").toBeEnabled();
  await expect(addBtn).toHaveAttribute("data-add-variant-state", "ready");
  await expect(page.locator("#lg-add-variant-why"), "no blocked reason while it is usable").toHaveCount(0);
  note(`E1 ready    state=${await addBtn.getAttribute("data-add-variant-state")} disabled=${await addBtn.isDisabled()}`);
  await shot(page, "e1-ready-running-test", "#lg-add-variant");

  // --- (4) step 3: Add variant -> the fork SUCCEEDS -------------------------
  page.on("dialog", (d) => void d.accept("50"));
  const armsBefore = (
    await json<{ funnels: Array<{ public_id: string; variants: unknown[] }> }>(
      await apiCtx.get(`${LG_API}/quotes/${seed.quotePublicId}`),
      "arms before",
    )
  ).funnels.find((f) => f.public_id === seed.funnels[0]!.public_id)!.variants.length;
  await addBtn.click();
  // fork -> stop -> re-split -> start, then the island navigates back to the editor
  await expect(page.locator(".lg-alloc-row"), "the forked 2nd arm lands on the tab").toHaveCount(2, { timeout: 45_000 });
  await openAbTab(page, seed.quotePublicId, variantId);
  const armsAfter = (
    await json<{ funnels: Array<{ public_id: string; variants: unknown[] }> }>(
      await apiCtx.get(`${LG_API}/quotes/${seed.quotePublicId}`),
      "arms after",
    )
  ).funnels.find((f) => f.public_id === seed.funnels[0]!.public_id)!.variants.length;
  note(`E1 arms before=${armsBefore} after=${armsAfter}`);
  expect(armsAfter, "the real Create->Start->Add path really forked a 2nd arm").toBe(armsBefore + 1);
  await expect(page.locator(".lg-alloc-row"), "two arms on the tab").toHaveCount(2);
  const sums = await page.locator(".lg-alloc-input").evaluateAll((els) =>
    els.map((e) => (e as HTMLInputElement).value),
  );
  note(`E1 arm allocations after fork = ${JSON.stringify(sums)}`);
  await shot(page, "e1-forked-two-arms", "#lg-ab-variant-list");

  // --- (5) the third blocked state: a running test's arm set is frozen ------
  await expect(addBtn).toHaveAttribute("data-add-variant-state", "arms-frozen");
  await expect(addBtn).toBeDisabled();
  note(`E1 arms-frozen reason = ${JSON.stringify((await page.locator("#lg-add-variant-why").innerText()).replace(/\s+/g, " ").trim())}`);
  await shot(page, "e1-arms-frozen", "#lg-add-variant");
});

// ===========================================================================
// E2 — where does scales.radius stop? Stored -> emitted CSS vars -> painted.
// ===========================================================================
test("E2 drive — trace scales.radius from the stored theme to the painted element", async ({ page }) => {
  const u = uniqueTag("f3e2");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p6f3e2",
    funnels: [
      { headline: `fixes3 E2 A ${u}`, field: "e2_a" },
      { headline: `fixes3 E2 B ${u}`, field: "e2_b" },
    ],
  });

  // Author ONLY scales.radius, through the REAL Themes tab (E10/E11: the
  // producer side is the real operator control, not a hand-built row).
  const setRadius = async (variantPublicId: string, radius: string): Promise<void> => {
    await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantPublicId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-tab="themes"]').click();
    await expect(page.locator("#lg-theme-editor")).toBeVisible({ timeout: 15_000 });
    await page.locator('#lg-theme-editor [data-theme-key="scales.radius"]').selectOption(radius);
    await page.locator("#lg-variant-save").click();
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 15_000 });
  };
  await setRadius(seed.funnels[0]!.variant_public_id, "sharp");
  await setRadius(seed.funnels[1]!.variant_public_id, "round");

  // LAYER 1 — stored.
  const themeA = await json<Record<string, unknown>>(await apiCtx.get(`${LG_API}/funnels/${seed.funnels[0]!.public_id}/theme`), "theme A");
  const themeB = await json<Record<string, unknown>>(await apiCtx.get(`${LG_API}/funnels/${seed.funnels[1]!.public_id}/theme`), "theme B");
  note(`E2 L1 stored A theme = ${JSON.stringify(themeA["theme"])}`);
  note(`E2 L1 stored B theme = ${JSON.stringify(themeB["theme"])}`);

  await createRoutingRule(apiCtx, seed.quotePublicId, {
    rule_name: `E2 to B ${u}`,
    priority: 1,
    conditions: { groups: [{ field: "utm_source", op: "eq", value: "funnelb" }] },
    target_funnel_id: seed.funnels[1]!.public_id,
  });
  await page.waitForTimeout(1200);
  await json(
    await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${seed.siteId}`, { data: { enabled: true, slug: seed.slug } }),
    "re-activate",
  );

  // LAYERS 3+4 — emitted custom properties and the PAINTED radius of every
  // element the visitor sees.
  const measure = async (utm: string, sid: string, label: string) => {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "ko_sid", value: sid, domain: seed.host, path: "/" }]);
    await page.goto(shellUrl(seed.host, seed.slug, `?utm_source=${utm}&_cb=${Date.now()}`), { waitUntil: "domcontentloaded" });
    await ready(page);
    const data = await page.locator("#lg-funnel-root").evaluate((root) => {
      const cs = getComputedStyle(root);
      const vars: Record<string, string> = {};
      ["sm", "md", "lg", "xl", "full"].forEach((k) => {
        vars[k] = cs.getPropertyValue("--lg-radius-" + k).trim();
      });
      const painted: Record<string, string> = {};
      const all = Array.from(root.querySelectorAll<HTMLElement>("*"));
      all.forEach((el) => {
        const key = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
        const r = getComputedStyle(el).borderRadius;
        if (painted[key] === undefined) painted[key] = r;
      });
      return { vars, painted, elementCount: all.length };
    });
    await shot(page, `e2-live-${label}`);
    return data;
  };
  const a = await measure("plain", `p6-f3e2-a-${u}`, "radius-sharp");
  const b = await measure("funnelb", `p6-f3e2-b-${u}`, "radius-round");

  note(`E2 L3 emitted --lg-radius-* A(sharp) = ${JSON.stringify(a.vars)}`);
  note(`E2 L3 emitted --lg-radius-* B(round) = ${JSON.stringify(b.vars)}`);
  note(`E2 L4 element counts A=${a.elementCount} B=${b.elementCount}`);
  const keys = Array.from(new Set([...Object.keys(a.painted), ...Object.keys(b.painted)])).sort();
  const diffs: string[] = [];
  const sames: string[] = [];
  keys.forEach((k) => {
    const ra = a.painted[k];
    const rb = b.painted[k];
    if (ra === undefined || rb === undefined) return; // funnel-specific markup
    if (ra !== rb) diffs.push(`${k}: A=${ra} B=${rb}`);
    else if (ra !== "0px") sames.push(`${k}: ${ra}`);
  });
  note(`E2 L4 shared elements compared = ${keys.length}`);
  note(`E2 L4 PAINTED RADIUS DIFFERENCES (${diffs.length}):`);
  diffs.forEach((d) => note(`  DIFF ${d}`));
  note(`E2 L4 non-zero radii that are IDENTICAL in both (${sames.length}):`);
  sames.slice(0, 40).forEach((s) => note(`  SAME ${s}`));

  // The token must reach the render: a `sharp` funnel and a `round` funnel
  // cannot paint identical corners everywhere.
  expect(a.vars["lg"], "the emitted --lg-radius-lg must differ between sharp and round").not.toBe(b.vars["lg"]);
  expect(diffs.length, "at least one painted element must carry the theme's radius").toBeGreaterThan(0);
});
