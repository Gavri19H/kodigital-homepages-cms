// LeadGen Round-4 Remediation — Phase P6b probe spec. Drives the REAL admin
// UI at :<PW_PORT>, real click/selectOption/fill (ZERO dispatchEvent):
//   * author a theme in the Quotes Themes tab's INLINE builder (a new
//     self-hosted display font, the display-XXL ramp, and the "soft"
//     button-fill style) -> Save -> the LIVE funnel reflects it (the SAME
//     resolveTokens mechanism __p6a-theme.spec.ts already proves end-to-end
//     for the inline theme_json path — this proves the NEW UI authors that
//     SAME shape correctly);
//   * theme PRESETS (the KV `lg-funnel-themes` catalog, themes-handlers.ts):
//     apply a saved preset to a funnel via the new picker -> the funnel's
//     theme_id + the live render both reflect it; delete an unreferenced
//     preset through the embedded theme-manager's own new Delete button
//     (real click + real confirm() dialog); a preset referenced by a funnel
//     is refused with a 409 naming that funnel (server-truth, asserted
//     directly — the guard itself is themes-handlers.ts's own logic, not a
//     UI affordance);
//   * "A/B this theme": pick a preset in that SAME selector, one click forks
//     the current variant, assigns the preset to the new arm, and applies
//     the chosen traffic split;
//   * the A/B tab's template-level reframe: "Add variant" + the allocation
//     editor + the per-arm what-varies summary.
//
// chromium-only (a non-gesture admin-UI spec, like __p5b-quotes-ia /
// __p6a-theme). Admin UI on 127.0.0.1 — no tenant host — except the ONE
// live-funnel assertions, which resolve a real e2e.test tenant host exactly
// like __p6a-theme.spec.ts.

import { test, expect, request as playwrightRequest, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// A minimal live-render probe: QuestionHeadline (display font + display-XXL)
// + ContinueButton (the button-fill axis) — the exact two component types
// __p6a-theme.spec.ts already proved carry the display/button-style signal,
// reused here rather than re-derived.
function richSection(name: string, field: string): Record<string, unknown> {
  return {
    section_name: name,
    headline_text: name,
    activity: "quote_funnel",
    vertical: "life",
    status: "active",
    content_json: JSON.stringify({
      components: [
        { type: "QuestionHeadline", question_id: `q_${field}_h`, bind: "section_headline", props: {} },
        { type: "ContinueButton", question_id: `q_${field}_cont`, props: { label: "Continue" } },
      ],
    }),
  };
}

interface ThemeRecordPayload {
  name: string;
  roles: {
    brand_primary: string;
    accent: string;
    page_bg: string;
    card: string;
    text: string;
    success: string;
    error: string;
  };
  typography: { headline_font: "Newsreader" | "Inter" | "Roboto Mono"; body_font: "Newsreader" | "Inter" | "Roboto Mono"; base_px: number };
  controls: { field_height: "small" | "medium" | "large"; button_size: "s" | "m" | "l"; corners: "sharp" | "rounded" | "pill" };
}

function themePayload(name: string, headlineFont: ThemeRecordPayload["typography"]["headline_font"]): ThemeRecordPayload {
  return {
    name,
    roles: {
      brand_primary: "#123456",
      accent: "#654321",
      page_bg: "#FFFFFF",
      card: "#FFFFFF",
      text: "#101010",
      success: "#0E7C3A",
      error: "#B23A2C",
    },
    typography: { headline_font: headlineFont, body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  host: string;
  slug: string;
}

async function seedQuote(request: APIRequestContext, tag: string): Promise<SeededQuote> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const safe = tag.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const host = `lg-p6b-${safe}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P6b ${safe} ${uniq}`);

  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `P6b ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;

  const field = `f${uniq}`;
  const section = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, { data: richSection(`p6b-${safe}-q1`, field) }),
    "section create",
  );
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.public_id }] }] },
    }),
    "variant pages",
  );
  await json(
    await request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, {
      data: { frame_config_json: { version: 1, template: "centered" } },
    }),
    "funnel frame",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: safe } }),
    "activation",
  );
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId, host, slug: safe };
}

function canvas(page: Page): FrameLocator {
  return page.frameLocator("#lg-preview-iframe");
}

async function openEditor(page: Page, quotePublicId: string, variantPublicId?: string): Promise<void> {
  const qs = variantPublicId ? `?variant=${encodeURIComponent(variantPublicId)}` : "";
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit${qs}`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-frame-region='section_slot']")).toBeVisible({ timeout: 20_000 });
}

const shellUrl = (s: SeededQuote): string => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

async function computed(page: Page, selector: string, prop: string): Promise<string> {
  return page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});

test.afterAll(async () => {
  await apiCtx.dispose();
});

test.describe("P6b — Themes tab inline builder", () => {
  test("authoring a new self-hosted font + display-XXL + a button style in the Themes tab, then Save, reaches the live funnel", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "author");
    await openEditor(page, seed.quotePublicId);

    await page.locator('.lg-qtab[data-tab="themes"]').click();
    await expect(page.locator('[data-panel="themes"]')).toHaveClass(/active/);
    await expect(page.locator("#lg-themes-panel-mount #lg-theme-editor")).toBeVisible();

    await page.locator('[data-theme-key="typography.display"]').selectOption("poppins");
    await page.locator('[data-theme-key="typography.display_size"]').selectOption("xxl");
    await page.locator('[data-theme-key="button_defaults.fill"]').selectOption("soft");

    await page.locator("#lg-variant-save").click();
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved");

    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await page.locator(".lg-headline").first().waitFor();
    const size = Number.parseFloat(await computed(page, ".lg-headline", "font-size"));
    expect(size).toBeGreaterThan(68);
    expect(size).toBeLessThan(76);
    expect(await computed(page, ".lg-headline", "font-family")).toContain("Poppins");
    const radius = Number.parseFloat(await computed(page, ".lg-continue", "border-top-left-radius"));
    expect(radius).toBeGreaterThan(40);
  });
});

test.describe("P6b — theme presets (apply / delete)", () => {
  test("applying a saved preset via the Themes-tab picker sets the funnel's theme_id and reaches the live funnel", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "apply");
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const presetName = `P6b Apply ${uniq}`;
    // Roboto Mono is never a base-design headline default (base defaults are
    // Sora/Literata/Newsreader, per theme.ts's own doc comment) — an
    // unambiguous signal that the LIVE font-family came from THIS preset.
    const created = await json<{ item: { id: string } }>(
      await apiCtx.post(`${LG_API}/themes`, { data: themePayload(presetName, "Roboto Mono") }),
      "create preset",
    );
    const themeId = created.item.id;

    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="themes"]').click();
    const select = page.locator("#lg-theme-preset-select");
    await expect(select.locator(`option[value="${themeId}"]`)).toHaveText(presetName, { timeout: 10_000 });
    await select.selectOption(themeId);

    const reloaded = page.waitForEvent("load");
    await page.locator("#lg-theme-preset-apply").click();
    await reloaded;

    const funnel = await json<{ theme_json: { theme_id?: string } | null }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}`),
      "get funnel after apply",
    );
    expect(funnel.theme_json && funnel.theme_json.theme_id).toBe(themeId);

    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await page.locator(".lg-headline").first().waitFor();
    expect(await computed(page, ".lg-headline", "font-family")).toContain("Roboto Mono");
  });

  test("an unreferenced preset can be deleted from the embedded theme-manager (real click + confirm)", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "delunref");
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const unrefName = `P6b Delete Me ${uniq}`;
    const created = await json<{ item: { id: string } }>(
      await apiCtx.post(`${LG_API}/themes`, { data: themePayload(unrefName, "Newsreader") }),
      "create unreferenced preset",
    );

    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="themes"]').click();
    const frame = page.frameLocator("#lg-theme-presets-frame");
    await frame.locator("a", { hasText: unrefName }).click();
    await expect(frame.locator("#tm-delete-theme")).toBeVisible({ timeout: 10_000 });

    const deleteReq = page.waitForResponse(
      (res) => res.request().method() === "DELETE" && res.url().includes(`/themes/${created.item.id}`),
    );
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await frame.locator("#tm-delete-theme").click();
    const deleteRes = await deleteReq;
    expect(deleteRes.status()).toBe(200);

    const getAfter = await apiCtx.get(`${LG_API}/themes/${created.item.id}`);
    expect(getAfter.status()).toBe(404);
  });

  test("a preset referenced by a funnel is refused (409) and names that funnel; unreferenced it deletes clean (200)", async ({}) => {
    const seed = await seedQuote(apiCtx, "delref");
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const refName = `P6b Referenced ${uniq}`;
    const created = await json<{ item: { id: string } }>(
      await apiCtx.post(`${LG_API}/themes`, { data: themePayload(refName, "Newsreader") }),
      "create referenced preset",
    );

    const funnelBefore = await json<{ funnel_name: string }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}`),
      "get funnel name",
    );
    await json(
      await apiCtx.put(`${LG_API}/funnels/${seed.funnelPublicId}/theme`, {
        data: { theme_json: { theme_id: created.item.id } },
      }),
      "assign referenced preset to the funnel",
    );

    const refusedRes = await apiCtx.delete(`${LG_API}/themes/${created.item.id}`);
    expect(refusedRes.status()).toBe(409);
    const refusedBody = (await refusedRes.json()) as { error: string; usage: { funnels: Array<{ funnel_name: string }> } };
    expect(refusedBody.error).toContain("used by 1 funnel");
    expect(refusedBody.error).toContain(funnelBefore.funnel_name);
    expect(refusedBody.usage.funnels.map((f) => f.funnel_name)).toContain(funnelBefore.funnel_name);

    // Unreference (switch the funnel back to an inline/empty theme — PUT
    // .../theme has no explicit "clear" value; {} is a valid, absent-fields
    // ThemeJson, i.e. no theme_id anymore) then delete cleanly (200).
    await json(
      await apiCtx.put(`${LG_API}/funnels/${seed.funnelPublicId}/theme`, { data: { theme_json: {} } }),
      "unassign the preset",
    );
    const cleanRes = await apiCtx.delete(`${LG_API}/themes/${created.item.id}`);
    expect(cleanRes.status()).toBe(200);
    const getAfter = await apiCtx.get(`${LG_API}/themes/${created.item.id}`);
    expect(getAfter.status()).toBe(404);
  });
});

test.describe("P6b — theme A/B fork + the A/B tab's template-level reframe", () => {
  test("'A/B this theme' forks the variant, assigns the picked preset to the new arm, and applies the chosen split", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "abtheme");
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const themeBName = `P6b Theme B ${uniq}`;
    const themeB = await json<{ item: { id: string } }>(
      await apiCtx.post(`${LG_API}/themes`, { data: themePayload(themeBName, "Inter") }),
      "create theme B",
    );

    await openEditor(page, seed.quotePublicId, seed.variantPublicId);
    await page.locator('.lg-qtab[data-tab="themes"]').click();
    const select = page.locator("#lg-theme-preset-select");
    await expect(select.locator(`option[value="${themeB.item.id}"]`)).toHaveText(themeBName, { timeout: 10_000 });
    await select.selectOption(themeB.item.id);

    const forkReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/variants\/.+\/fork$/.test(res.url()));
    // The page is ALREADY on .../edit?variant=<id> before this click (openEditor
    // navigated there) — waitForURL on the SAME pattern would resolve against
    // the CURRENT url instead of the reload this action triggers, racing the
    // second PUT (the original arm's shrunk allocation) that fires AFTER the
    // fork. Wait for that specific PUT response instead — deterministic.
    const putOriginalReq = page.waitForResponse(
      (res) => res.request().method() === "PUT" && res.url().endsWith(`/variants/${seed.variantPublicId}`),
    );
    page.once("dialog", (dialog) => {
      void dialog.accept("30");
    });
    await page.locator("#lg-theme-ab-this").click();
    const forkRes = await forkReq;
    expect(forkRes.status()).toBe(201);
    const forkBody = (await forkRes.json()) as { public_id: string };
    const putOriginalRes = await putOriginalReq;
    expect(putOriginalRes.status()).toBe(200);

    const variants = await json<{
      items: Array<{ public_id: string; traffic_allocation_bp: number; frame_overrides_json: { theme_id?: string } | null }>;
    }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/variants`), "list funnel variants");

    const newArm = variants.items.find((v) => v.public_id === forkBody.public_id);
    expect(newArm).toBeTruthy();
    expect(newArm!.traffic_allocation_bp).toBe(3000);
    expect(newArm!.frame_overrides_json && newArm!.frame_overrides_json.theme_id).toBe(themeB.item.id);

    const original = variants.items.find((v) => v.public_id === seed.variantPublicId);
    expect(original!.traffic_allocation_bp).toBe(7000);
  });

  test("the A/B tab offers Add variant + the allocation editor + a per-arm what-varies summary", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "addvariant");
    await openEditor(page, seed.quotePublicId, seed.variantPublicId);

    const abPanel = page.locator('[data-panel="ab"]');
    await page.locator('.lg-qtab[data-tab="ab"]').click();
    await expect(abPanel).toHaveClass(/active/);
    await expect(page.locator("#lg-add-variant")).toBeVisible();
    // "Fork this variant" renders TWICE (the always-visible top variant bar,
    // AND this panel's own toolbar, both pre-existing) — scope to the A/B
    // panel's copy specifically, avoiding a strict-mode ambiguity.
    await expect(abPanel.locator("[data-fork-variant]")).toBeVisible();
    await expect(page.locator("[data-alloc-sum]")).toBeVisible();
    await expect(page.locator(`[data-arm-variance="${seed.variantPublicId}"]`)).toHaveText("Control");

    const forkReq = page.waitForResponse((res) => res.request().method() === "POST" && /\/variants\/.+\/fork$/.test(res.url()));
    // SAME race as the theme-A/B test above: the page is already on a
    // .../edit?variant= URL, so waitForURL on that SAME pattern would
    // resolve instantly against the CURRENT url rather than the reload this
    // action triggers after its PUTs. Wait for the reload-triggering PUT
    // response, then a real `load` event (registered before the click, since
    // the reload target URL is unchanged too — waitForURL would be equally
    // useless here) — both deterministic, neither URL-string-dependent.
    const putOriginalReq = page.waitForResponse(
      (res) => res.request().method() === "PUT" && res.url().endsWith(`/variants/${seed.variantPublicId}`),
    );
    const reloaded = page.waitForEvent("load");
    page.once("dialog", (dialog) => {
      void dialog.accept("25");
    });
    await page.locator("#lg-add-variant").click();
    const forkRes = await forkReq;
    expect(forkRes.status()).toBe(201);
    const forkBody = (await forkRes.json()) as { public_id: string };
    await putOriginalReq;
    await reloaded;
    await page.locator('.lg-qtab[data-tab="ab"]').click();

    const newRow = page.locator(`[data-variant="${forkBody.public_id}"]`);
    await expect(newRow).toBeVisible();
    // A plain "Add variant" fork changes nothing (same template/theme/
    // sections/rules as control) — the honest, non-inflated summary.
    await expect(newRow.locator("[data-arm-variance]")).toHaveText("Same as control (no differences yet)");
  });
});
