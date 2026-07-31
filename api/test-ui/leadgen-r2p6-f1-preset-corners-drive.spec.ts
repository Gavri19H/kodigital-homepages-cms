// LeadGen R2 · P6 terminal — F-1 DRIVE: a theme PRESET's "Corners" control on
// the live visitor page.
//
// DEFECT (measured, not reasoned): the P6 radius fix reaches the painted
// corners only through the INLINE theme_json path (scales.radius). A funnel
// whose theme_json is a {theme_id} REFERENCE gets `theme = {}` in
// resolveTokens, so radiusScale is always the "soft" identity and the record's
// controls.corners never moves a single painted pixel — an operator picks
// Pill in the Themes manager, looks at the funnel, and sees square corners.
//
// This spec measures the PAINTED border-radius (getComputedStyle on the live
// /lg page), never the emitted custom properties alone, and never source:
//   A · preset path   — ONE preset flipped Sharp -> Rounded -> Pill on the SAME
//                       funnel, authored through the REAL Themes manager
//                       segmented control and applied through the REAL quote
//                       editor "Apply to this funnel" button.
//   B · inline path   — the quote Themes rail [data-theme-key="scales.radius"]
//                       sharp vs round (the P6 regression pin: 10/6/6 vs
//                       20/14/14).
//   C · no-theme      — the seeded fixture funnel, untouched: its painted radii
//                       AND its whole emitted chrome <style> block hashed, so a
//                       before/after run proves byte-identity.
//
// Run (worktree-isolated, this worktree's port):
//   cd api && PW_PORT=8901 npx playwright test \
//     test-ui/leadgen-r2p6-f1-preset-corners-drive.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  LG_API,
  ORIGIN,
  PORT,
  REAL_CHROME_UA,
  json,
  ready,
  seedRoutingQuote,
  shellUrl,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";

const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p6/f1-preset-corners";
mkdirSync(EVIDENCE_DIR, { recursive: true });
const MEASUREMENTS = `${EVIDENCE_DIR}/measurements.txt`;
// ARM=before (pre-fix) / after (post-fix) — stamped into every line so the two
// runs are comparable in one file.
const ARM = process.env["F1_ARM"] ?? "unset";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  appendFileSync(MEASUREMENTS, `\n===== ARM=${ARM} run ${new Date().toISOString()} =====\n`);
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

function note(line: string): void {
  appendFileSync(MEASUREMENTS, `[${ARM}] ${line}\n`);
}

// E6: the same state at 1280 AND 375, with the 375 overflow measured.
async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-1280.png`, fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-375.png`, fullPage: false });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  note(`${name} @375 scrollWidth=${m.sw} innerWidth=${m.iw} overflow=${m.sw > m.iw ? "YES" : "no"}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
}

interface Painted {
  card: string;
  answer: string;
  continue_: string;
  progressTrack: string;
  progressFill: string;
  vars: Record<string, string>;
}

// The three corners an operator actually looks at, plus the progress pill (the
// 9999px semantic carve-out that must NEVER move) and the emitted scale vars.
async function measureLive(page: Page, host: string, slug: string, label: string): Promise<Painted> {
  await page.goto(shellUrl(host, slug, `?_cb=${Date.now()}${Math.floor(Math.random() * 1000)}`), {
    waitUntil: "domcontentloaded",
  });
  await ready(page);
  const data = await page.locator("#lg-funnel-root").evaluate((root) => {
    const r = (sel: string): string => {
      const el = root.querySelector<HTMLElement>(sel);
      return el === null ? "ABSENT" : getComputedStyle(el).borderRadius;
    };
    const cs = getComputedStyle(root);
    const vars: Record<string, string> = {};
    ["sm", "md", "lg", "xl", "full"].forEach((k) => {
      vars[k] = cs.getPropertyValue("--lg-radius-" + k).trim();
    });
    return {
      card: r(".lg-question-card"),
      answer: r(".lg-btn-answer"),
      continue_: r(".lg-continue"),
      progressTrack: r(".lg-progress-track"),
      progressFill: r(".lg-progress-fill"),
      vars,
    };
  });
  note(
    `${label} PAINTED card=${data.card} answer=${data.answer} continue=${data.continue_} ` +
      `progressTrack=${data.progressTrack} progressFill=${data.progressFill} vars=${JSON.stringify(data.vars)}`,
  );
  return data;
}

// ===========================================================================
// A — the PRESET path: one preset, Corners flipped, on the live visitor page.
// ===========================================================================
test("A — a preset's Corners control governs the painted corners on the live page", async ({ page }) => {
  const u = uniqueTag("f1a");
  const seed = await seedRoutingQuote(apiCtx, {
    tag: "p6f1a",
    sharedHeadline: `F1 preset ${u}`,
    sharedQuestionField: "f1a_shared",
    funnels: [{ headline: `F1 preset tail ${u}`, field: "f1a_tail" }],
  });
  const funnelId = seed.funnels[0]!.public_id;
  const variantId = seed.funnels[0]!.variant_public_id;

  // --- (1) build the preset through the REAL Themes manager ----------------
  await page.goto(`${ORIGIN}/admin/leadgen/themes?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.locator("#tm-new-theme").click();
  // the island navigates to ?theme=<new id> on a 201 — the id the operator now
  // has selected in the manager (reading the POST body races the navigation).
  await page.waitForURL(/\/admin\/leadgen\/themes\?theme=/, { timeout: 20_000 });
  const themeId = new URL(page.url()).searchParams.get("theme") ?? "";
  note(`A preset created id=${themeId}`);
  expect(themeId, "the Themes manager minted a preset id").not.toBe("");

  // The operator's control: the Corners segmented control in the manager.
  const setCorners = async (value: string): Promise<void> => {
    await page.goto(`${ORIGIN}/admin/leadgen/themes?theme=${themeId}&_cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });
    const seg = page.locator(`[data-tm-seg][data-group="corners"][data-value="${value}"]`).first();
    await expect(seg, `the Corners "${value}" segment is on the manager`).toBeVisible({ timeout: 15_000 });
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/api/admin/leadgen/themes/${themeId}`) && r.request().method() === "PATCH",
    );
    await seg.click();
    const res = await patched;
    // the island re-renders after the PATCH, so the browser-side body is gone —
    // read the STORED record back over the API instead (the durable side).
    const status = res.status();
    await page.waitForTimeout(600);
    const readBack = await json<{ item: { controls: { corners: string } } }>(
      await apiCtx.get(`${LG_API}/themes/${themeId}`),
      "theme read-back",
    );
    note(`A PATCH corners=${value} HTTP ${status} stored=${JSON.stringify(readBack.item.controls)}`);
    expect(status, "the Corners PATCH is accepted").toBe(200);
    expect(readBack.item.controls.corners, "the stored record carries the picked corners").toBe(value);
    // the theme-edit cache invalidation rides waitUntil — let it land
    await page.waitForTimeout(1200);
  };

  // ADJACENT (pre-existing, NOT this slice): a theme-record edit sweeps the KV
  // shell entries (invalidateThemeAcrossFunnels -> invalidateOnVariantPublish,
  // measured: `wrangler kv key list --prefix lg-shell:` returns [] right after
  // the PATCH) but NEVER the caches.default mirror edge-cache.ts writes beside
  // them, so the pre-edit shell keeps serving from that mirror for up to
  // HTML_CACHE_TTL_SECONDS (60 dev / 300 prod). Each arm below therefore also
  // performs the operator's own activation re-PUT, which bumps
  // leadgen_site_quotes.updated_at -> a FRESH shell key: cache-keys.ts's OWN
  // documented mirror-safe path ("Folding updated_at in makes any activation
  // edit mint a FRESH key + ETag -> self-correcting, mirror-safe"). The
  // pre-bump reading is recorded too, as the evidence for that adjacent row.
  const bumpActivation = async (): Promise<void> => {
    const res = await apiCtx.put(`${LG_API}/quotes/${seed.quotePublicId}/activation/${seed.siteId}`, {
      data: { enabled: true, slug: seed.slug },
    });
    note(`A activation re-PUT (fresh shell key) HTTP ${res.status()}`);
    expect(res.status(), "the activation re-PUT succeeds").toBe(200);
    await page.waitForTimeout(1200);
  };

  await setCorners("sharp");

  // --- (2) apply it through the REAL "Apply to this funnel" button ---------
  await page.goto(`${ORIGIN}/admin/leadgen/quotes/${seed.quotePublicId}/edit?variant=${variantId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-tab="themes"]').click();
  const sel = page.locator("#lg-theme-preset-select");
  await expect(sel).toBeVisible({ timeout: 15_000 });
  await expect(sel.locator(`option[value="${themeId}"]`)).toHaveCount(1, { timeout: 15_000 });
  await sel.selectOption(themeId);
  const applied = page.waitForResponse(
    (r) => r.url().includes(`/funnels/${funnelId}/theme`) && r.request().method() === "PUT",
  );
  await page.locator("#lg-theme-preset-apply").click();
  const applyRes = await applied;
  note(`A apply-preset PUT HTTP ${applyRes.status()}`);
  expect(applyRes.status(), "apply-to-funnel succeeds").toBe(200);
  await page.waitForTimeout(1500);

  const stored = await json<{ theme: unknown }>(await apiCtx.get(`${LG_API}/funnels/${funnelId}/theme`), "stored theme");
  note(`A stored funnel theme_json = ${JSON.stringify(stored.theme)}`);
  expect(JSON.stringify(stored.theme), "the funnel stores a {theme_id} REFERENCE").toContain(themeId);

  // --- (3) measure the live visitor page: sharp -> rounded -> pill ---------
  const arm = async (value: string): Promise<Painted> => {
    await measureLive(page, seed.host, seed.slug, `A corners=${value} PRE-BUMP (stale-mirror row)`);
    await bumpActivation();
    const m = await measureLive(page, seed.host, seed.slug, `A corners=${value}`);
    await shot(page, `a-preset-${value}`);
    return m;
  };

  const sharp = await arm("sharp");
  await setCorners("rounded");
  const rounded = await arm("rounded");
  await setCorners("pill");
  const pill = await arm("pill");

  note(`A SUMMARY sharp=${sharp.card}/${sharp.answer}/${sharp.continue_}`);
  note(`A SUMMARY rounded=${rounded.card}/${rounded.answer}/${rounded.continue_}`);
  note(`A SUMMARY pill=${pill.card}/${pill.answer}/${pill.continue_}`);

  // The three corners the operator looks at must MOVE, in the inline path's
  // direction (sharp < rounded < pill).
  const px = (v: string): number => Number.parseFloat(v);
  expect(sharp.card, "question-card corners must differ between Sharp and Pill").not.toBe(pill.card);
  expect(sharp.answer, "answer-button corners must differ between Sharp and Pill").not.toBe(pill.answer);
  expect(sharp.continue_, "continue-button corners must differ between Sharp and Pill").not.toBe(pill.continue_);
  expect(px(sharp.card), "Sharp is tighter than Rounded (card)").toBeLessThan(px(rounded.card));
  expect(px(rounded.card), "Rounded is tighter than Pill (card)").toBeLessThan(px(pill.card));
  expect(px(sharp.answer), "Sharp is tighter than Pill (answer)").toBeLessThan(px(pill.answer));
  expect(px(sharp.continue_), "Sharp is tighter than Pill (continue)").toBeLessThan(px(pill.continue_));

  // `rounded` is the record default => the "soft" identity => today's look.
  expect(rounded.card, "Rounded (the record default) is the unthemed identity").toBe("16px");
  expect(rounded.answer, "Rounded (the record default) is the unthemed identity").toBe("10px");
  expect(rounded.continue_, "Rounded (the record default) is the unthemed identity").toBe("10px");

  // The progress pill is semantic "fully round" — never shifts.
  for (const arm of [sharp, rounded, pill]) {
    expect(arm.progressTrack, "the progress pill stays 9999px").toBe("9999px");
    expect(arm.progressFill, "the progress pill stays 9999px").toBe("9999px");
    expect(arm.vars["full"], "--lg-radius-full stays 9999px").toBe("9999px");
  }
});

// ===========================================================================
// B — the INLINE path regression pin: sharp 10/6/6 vs round 20/14/14.
// ===========================================================================
test("B — the inline Themes-rail scales.radius still paints 10/6/6 (sharp) vs 20/14/14 (round)", async ({ page }) => {
  const u = uniqueTag("f1b");
  const seedA = await seedRoutingQuote(apiCtx, {
    tag: "p6f1bs",
    sharedHeadline: `F1 inline sharp ${u}`,
    sharedQuestionField: "f1b_s",
    funnels: [{ headline: `F1 inline sharp tail ${u}`, field: "f1b_st" }],
  });
  const seedB = await seedRoutingQuote(apiCtx, {
    tag: "p6f1br",
    sharedHeadline: `F1 inline round ${u}`,
    sharedQuestionField: "f1b_r",
    funnels: [{ headline: `F1 inline round tail ${u}`, field: "f1b_rt" }],
  });

  const setRadius = async (quotePublicId: string, variantPublicId: string, radius: string): Promise<void> => {
    await page.goto(`${ORIGIN}/admin/leadgen/quotes/${quotePublicId}/edit?variant=${variantPublicId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-tab="themes"]').click();
    await expect(page.locator("#lg-theme-editor")).toBeVisible({ timeout: 15_000 });
    await page.locator('#lg-theme-editor [data-theme-key="scales.radius"]').selectOption(radius);
    await page.locator("#lg-variant-save").click();
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
  };
  await setRadius(seedA.quotePublicId, seedA.funnels[0]!.variant_public_id, "sharp");
  await setRadius(seedB.quotePublicId, seedB.funnels[0]!.variant_public_id, "round");

  const a = await measureLive(page, seedA.host, seedA.slug, "B inline=sharp");
  await shot(page, "b-inline-sharp");
  const b = await measureLive(page, seedB.host, seedB.slug, "B inline=round");
  await shot(page, "b-inline-round");

  note(`B SUMMARY inline sharp=${a.card}/${a.answer}/${a.continue_} round=${b.card}/${b.answer}/${b.continue_}`);

  expect(a.card, "inline sharp question card").toBe("10px");
  expect(a.answer, "inline sharp answer button").toBe("6px");
  expect(a.continue_, "inline sharp continue button").toBe("6px");
  expect(b.card, "inline round question card").toBe("20px");
  expect(b.answer, "inline round answer button").toBe("14px");
  expect(b.continue_, "inline round continue button").toBe("14px");
  expect(a.progressTrack).toBe("9999px");
  expect(b.progressTrack).toBe("9999px");
});

// ===========================================================================
// C — the NO-THEME funnel: painted radii AND the whole emitted chrome <style>
//     block hashed, so before/after runs prove byte-identity.
// ===========================================================================
test("C — the seeded no-theme funnel is byte-identical (painted radii + chrome CSS hash)", async ({ page }) => {
  const host = "r2fix.e2e.test";
  const slug = "r2fix";

  // the APIRequestContext has no --host-resolver-rules — hit the loopback and
  // carry the vhost in the Host header (the same request the browser makes).
  const res = await apiCtx.get(`http://127.0.0.1:${PORT}/lg/${slug}?_cb=${Date.now()}`, {
    headers: { "user-agent": REAL_CHROME_UA, host },
  });
  expect(res.status(), "the seeded fixture funnel serves").toBe(200);
  const html = await res.text();
  const styles = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join("\n");
  const styleHash = createHash("sha256").update(styles).digest("hex");
  note(`C no-theme chrome <style> bytes=${styles.length} sha256=${styleHash}`);

  const m = await measureLive(page, host, slug, "C no-theme");
  await shot(page, "c-no-theme");
  note(`C SUMMARY no-theme=${m.card}/${m.answer}/${m.continue_}`);

  // The unthemed base design (tokens.ts radius sm6/md10/lg14/xl20).
  expect(m.card, "no-theme question card").toBe("16px");
  expect(m.answer, "no-theme answer button").toBe("10px");
  expect(m.continue_, "no-theme continue button").toBe("10px");
  expect(m.vars).toEqual({ sm: "6px", md: "10px", lg: "14px", xl: "20px", full: "9999px" });
});
