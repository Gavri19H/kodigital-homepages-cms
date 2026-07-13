// LeadGen v3.1 contract §13 Gate 1c — Design parity, baseline snapshots.
// "At design sign-off the built UI's own screenshots of the 7 required
// states (Build default, headline selected, continue selected, custom-
// resized, Maps tab, Themes Navy, Themes Bold Yellow) become the frozen
// baseline; subsequent builds pixel-diff against THAT (≤0.1%, dynamic
// content masked)."
//
// SELF-BASELINE MECHANISM — mirrors api/test-ui/leadgen-visual.spec.ts's OWN
// hand-rolled pattern EXACTLY (NOT Playwright's built-in toHaveScreenshot,
// confirmed by direct read: leadgen-visual.spec.ts has zero references to
// toHaveScreenshot/toMatchSnapshot anywhere): first run writes the baseline
// PNG; every subsequent run pixel-diffs the fresh screenshot against it
// (per-channel threshold 8, changed-pixel ratio <= maxRatio) and additionally
// writes an evidence copy every run. maxRatio here is 0.001 (<=0.1%, the
// exact contract figure — leadgen-visual.spec.ts's own two thresholds are
// looser, 0.002/0.0025, for a LIVE runtime page with real fonts/rendering
// variance; the admin studio chrome is simpler DOM, so the contract's
// tighter 0.1% is used literally, not loosened to match runtime precedent).
//
// DYNAMIC CONTENT: this suite avoids the problem instead of masking it — the
// §1.2 fixture is fully deterministic (fixed section name/content/theme
// hex), `animations: "disabled"` is passed to every screenshot, and every
// state blurs focus before capture (mirroring gotoRuntime's own "blur the
// autofocused element" idiom) so a transient focus ring never causes a
// false diff.
//
// VIEWPORT HEIGHT — CONFIRMED NEEDED (not a style choice), via direct
// diagnosis of a real run of this file: the admin shell puts `html,body{
// height:100%;overflow-x:hidden}` PLUS a `body{overflow-y:auto}` (computed
// `overflow: hidden auto`) — i.e. <body> itself, not <html>/the viewport, is
// the scrolling container. `document.documentElement.scrollHeight` therefore
// NEVER reflects body's true (larger) content height, which means Playwright
// `page.screenshot({fullPage:true})` — which sizes its capture off
// `documentElement`'s reported scroll extent — cannot correctly capture this
// page: a live diagnostic run measured body.scrollHeight=2466 against
// documentElement.scrollHeight=900, and `fullPage:true` produced a garbled,
// wrongly-proportioned (2344x2466 non-viewport-ratio) capture with real
// content compressed into a fraction of the frame. Confirmed by visual
// inspection of the evidence PNG (not just the pixel-diff ratio — an earlier
// pass of this file mistakenly treated four ratio=0 baseline comparisons as
// "stable" without ever LOOKING at what they actually captured; they were
// four equally-garbled fullPage captures compared to each other). FIX: give
// the viewport enough HEIGHT that the whole editor (admin chrome + studio
// top bar/strip/body/drawer) renders with no scrolling needed anywhere, then
// take a PLAIN (non-fullPage) screenshot — confirmed by the same diagnostic
// to render correctly. 2600px comfortably exceeds the measured ~2466px
// total for this fixture's content.
//
// Seeding rides the REAL admin HTTP APIs only (repo convention — see
// leadgen-section-studio.spec.ts's createStudioSection /
// leadgen-theme-manager.spec.ts's seedThemesFixture). Local D1 must be
// migrated + seeded once beforehand:
// `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local`.
//
// PLAYWRIGHT HARD LESSON (dispatch instruction): run THIS FILE ONLY —
// `npx playwright test test-ui/leadgen-v31-gate1c-baselines.spec.ts --workers=1 --reporter=line`
// — never the full `npm run test:ui` (parks the harness).
//
// STABILITY FIX (fresh-environment flake, root-caused by direct code trace —
// NOT a guess): a FRESH environment (killed strays + wiped local D1 +
// migrate+seed + brand-new `wrangler dev`) occasionally failed state
// 01-build-default at changed-pixel ratio ~0.0082 (0.82%), while back-to-back
// runs in an already-warm environment always measured ratio=0. Root cause,
// confirmed by reading ui-section-studio.ts's client island (NOT masked —
// this is a deterministic, waitable settle, not run-to-run-varying content):
// the island's unconditional "first paint" boot sequence
// (`selectComponent(...); ...; loadOffers(); loadUsage(); loadThemesList();
// ...; runPreview();`) fires SEVERAL fetches on EVERY load of
// /admin/leadgen/sections/:id/edit — states 1-5 all land there. One of them,
// `loadUsage()`, GETs .../usage and its resolved callback calls
// `renderFramePreviewEmpty()`, which flips
// `[data-frame-preview-empty]` — SSR'd `hidden` (renderPreviewPanel(),
// ui-section-studio.ts) inside the DEFAULT-VISIBLE "Preview in a quote"
// drawer tab (renderStudioDrawer's `data-studio-drawer-panel="preview"` has
// NO `hidden` attribute, i.e. it's the tab shown on load, no click needed)
// — to VISIBLE the moment it confirms zero usage. This fixture's sections
// are NEVER attached to any funnel/quote, so usage is ALWAYS confirmed zero
// and the paragraph ALWAYS ends up shown — a 100%-deterministic SETTLED
// value; only its TIMING races a fixed wait (fast/warm server: always
// resolved well inside a short wait, ratio=0 every time; a genuinely cold
// Worker boot: occasionally still unresolved at capture time, so the
// visible text block is absent — a real, sizeable rendered-text region,
// consistent with an 0.82% delta). Because the settled value never varies,
// the correct fix is to WAIT for it (captured in waitForStudioSettled below
// + an explicit per-test assertion), not to mask it — masking is for content
// that legitimately varies even once settled (ids/timestamps), which this
// is not. waitForStudioSettled additionally waits for network-idle (a single
// blanket net over the OTHER unconditional on-load fetches —
// loadComponentPresets/loadFramePickerQuotes/loadActivities/loadVerticals/
// loadOffers/loadThemesList/runPreview — rather than hand-tracing each one's
// visible side effects individually; confirmed safe: neither this file's
// island nor ui-theme-manager.ts's ES5 island run any setInterval/
// EventSource/WebSocket that would keep the network non-idle forever),
// `document.fonts.ready` (parity with leadgen-visual.spec.ts's own
// determinism idiom — a no-op here since no admin page loads an external
// webfont (confirmed: zero `@font-face`/`fonts.googleapis` references under
// src/admin/), kept for discipline-parity and defense against any future
// admin webfont), and an injected transition/animation-disabling stylesheet
// (defense in depth on top of screenshot()'s own `animations:"disabled"` —
// belt, not replacement — covering e.g. the real 300ms `.studio-scope-header`
// background-color transition renderScopeHeader's "scope-flash" triggers on
// an actual selection change, per §7.2; confirmed NOT itself a source of
// this bug, since loadUsage's re-invocation of renderScopeHeader keeps the
// same selected node (`changed` stays false → no flash) — the injected style
// is precautionary, not a second root cause).
//
// SECOND FINDING (surfaced BY the wait fix, via a diff-highlight image — not
// a guess): once capture reliably waits for settle, states 1-4 (never state
// 5 — see below) stabilized to a small but NON-ZERO ratio (~0.00035-0.0004,
// still comfortably <=0.001). A diff-highlight render (baseline vs fresh
// evidence, same 3-channel/8 threshold as pixelDiffRatio, red = differs)
// isolated it to ONE 771x21px text line at the very bottom of the page: the
// default-visible "Preview in a quote" drawer's "Events that would fire"
// panel (§8.9/§9.1), which lists an initial `quote_view` event whose JSON
// payload includes `"session_id":"<uuid>"` — genuinely, unavoidably random
// PER PAGE LOAD (appendPreviewEvents/onPreviewMessage,
// ui-section-studio.ts) — no wait can settle a value that is regenerated
// differently every time by design. This is exactly the contract's own
// "dynamic content masked" carve-out (an id, not a timing race), so it is
// MASKED (Playwright's screenshot `mask:` option — confirmed to apply to
// plain page.screenshot(), not just toHaveScreenshot) at
// `[data-studio-events-list]` (appendPreviewEvents' own mount point,
// ui-section-studio.ts:8050 — every event row lives inside this one `<ol>`;
// nothing dynamic renders outside it), not waited-for. Applied uniformly in
// captureBaseline (harmless where the selector is absent, e.g. the
// Themes-manager pages — Playwright ignores a mask locator that resolves to
// zero elements). State 5 (Maps tab) measured ratio=0 in the same runs
// (confirmed by direct crop-and-view of its evidence PNG: the events line
// simply isn't in the same y-band there, most likely because selecting the
// Maps inspector tab changes the row height above the drawer) — but the
// SAME session_id mechanism applies structurally to every state 1-5 (same
// drawer, same preview panel), so state 5 gets the identical mask rather
// than relying on it happening not to collide this time.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test.use({ viewport: { width: 1280, height: 2600 } });

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(SPEC_DIR, "__screenshots__", "leadgen-v31-gate1c");
const EVIDENCE_DIR = "test-artifacts/leadgen-v31-gate1c";
const LG_API = "/api/admin/leadgen";
const MAX_RATIO = 0.001; // contract §13 Gate 1c: "≤0.1%"
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

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
interface ThemeCreated {
  item: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// §1.2 fixture content — Zip / Insurance / Car / ZIP field / bound headline+
// subheadline+Continue. Two content variants: DEFAULT (no size override —
// states a/b/c/e) and CUSTOM-RESIZED (ZIP field pre-seeded with
// design_overrides.size.width.custom_px — state d), so the "custom-resized"
// baseline never depends on reproducing a live drag gesture (the SAME
// engineering choice this phase's Gate 4 probe 3 makes for its Reset proof).
// ---------------------------------------------------------------------------

function fixtureContent(customPx?: number): Record<string, unknown> {
  const zipNode: Record<string, unknown> = {
    type: "ZIPInputQuestion",
    question_id: "q_zip",
    internal_field: "zip",
    answer_type: "string",
    required: true,
    props: { label: "ZIP code", placeholder: "Enter your ZIP code", helper: "We never share this", format: "us_zip" },
  };
  if (customPx !== undefined) {
    zipNode["design_overrides"] = { size: { width: { custom_px: customPx } } };
  }
  return {
    components: [
      { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
      { type: "Subheadline", question_id: "q_bound_subheadline", bind: "section_subheadline" },
      zipNode,
      { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
    ],
  };
}

async function createFixtureSection(request: APIRequestContext, name: string, customPx?: number): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "Insurance",
        vertical: "Car",
        headline_text: "What's your ZIP code?",
        subheadline_text: "Rates differ by up to 40% based on ZIP code",
        continue_mode: "button",
        status: "active",
        content_json: fixtureContent(customPx),
      },
    }),
    `create fixture section (${name})`,
  );
}

function themeBody(name: string, brand: string, accent: string, pageBg: string, card: string, text: string) {
  return {
    name,
    roles: { brand_primary: brand, accent, page_bg: pageBg, card, text, success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

async function createTheme(
  request: APIRequestContext,
  name: string,
  brand: string,
  accent: string,
  pageBg: string,
  card: string,
  text: string,
): Promise<string> {
  const created = await json<ThemeCreated>(
    await request.post(`${LG_API}/themes`, { data: themeBody(name, brand, accent, pageBg, card, text) }),
    `create theme (${name})`,
  );
  return created.item.id;
}

interface Fixture {
  defaultSection: Created;
  customSection: Created;
  navyThemeId: string;
  boldThemeId: string;
}

let fx: Fixture;

test.beforeAll(async ({ playwright }) => {
  mkdirSync(BASELINE_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const ctx = await playwright.request.newContext({ baseURL: "http://127.0.0.1:8787" });
  const defaultSection = await createFixtureSection(ctx, `V31 Gate1c Default ${uniq}`);
  // 384 is the golden's own FAKE demo value (§0 fidelity-vs-function) —
  // reused here only as a plausible mid-range custom width for the
  // screenshot fixture, not asserted as a measured value anywhere (the
  // baseline is a PIXEL artifact; Gate 3/4's own tests assert the resolution
  // math, never this file).
  const customSection = await createFixtureSection(ctx, `V31 Gate1c Custom ${uniq}`, 384);
  // NOT uniq-suffixed (unlike the sections below): the theme name renders as
  // an UNTRUNCATED 21px title in the CENTER editor (no fixed-width/overflow
  // clip like the studio's 132px section-name INPUT has) — a run-varying
  // suffix here changes real, visible pixels. CONFIRMED (not speculative):
  // an earlier live run of this file with `Navy ${uniq}` measured a stable
  // changed-pixel ratio of ~0.00103 between two separate CLI invocations —
  // just over the 0.1% budget — traced to exactly this. Theme names have no
  // uniqueness constraint at the API level (multiple "Navy" records may
  // coexist across repeated local runs; each is selected by its OWN fresh
  // id, never by name), so a fixed, contract-literal name is safe here.
  const navyThemeId = await createTheme(ctx, "Navy", "#1B3A5C", "#F5C518", "#F4F6F9", "#FFFFFF", "#1A1F36");
  const boldThemeId = await createTheme(ctx, "Bold Yellow", "#13233B", "#F5C518", "#FFF7DE", "#FFFFFF", "#14181F");
  await ctx.dispose();
  fx = { defaultSection, customSection, navyThemeId, boldThemeId };
});

// ---------------------------------------------------------------------------
// Self-baseline mechanism (verbatim port of leadgen-visual.spec.ts's own
// pixelDiffRatio + baseline-exists branch — see file header).
// ---------------------------------------------------------------------------

async function pixelDiffRatio(page: Page, aPng: Buffer, bPng: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      function load(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      }
      const ia = await load(`data:image/png;base64,${a}`);
      const ib = await load(`data:image/png;base64,${b}`);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const draw = (img: HTMLImageElement): ImageData => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx2d = canvas.getContext("2d")!;
        ctx2d.drawImage(img, 0, 0);
        return ctx2d.getImageData(0, 0, img.width, img.height);
      };
      const da = draw(ia).data;
      const db = draw(ib).data;
      let diff = 0;
      const total = ia.width * ia.height;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i]! - db[i]!) > 8 || Math.abs(da[i + 1]! - db[i + 1]!) > 8 || Math.abs(da[i + 2]! - db[i + 2]!) > 8) {
          diff += 1;
        }
      }
      return diff / total;
    },
    [aPng.toString("base64"), bPng.toString("base64")] as const,
  );
}

// Determinism before every capture (file-header "STABILITY FIX" note has the
// full diagnosis): network-idle is one blanket wait over EVERY admin studio
// page's unconditional on-load fetches (confirmed safe — no setInterval/
// EventSource/WebSocket anywhere in ui-section-studio.ts or
// ui-theme-manager.ts that would keep the network non-idle forever);
// document.fonts.ready mirrors leadgen-visual.spec.ts's own idiom (a no-op
// here — no admin page loads an external webfont — kept for parity/defense);
// the injected stylesheet hard-disables transitions/animations (belt, on top
// of screenshot()'s own animations:"disabled") so no in-flight CSS
// transition (e.g. the real 300ms .studio-scope-header background-color
// transition) can be caught mid-frame.
async function waitForStudioSettled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }",
  });
}

async function captureBaseline(page: Page, name: string): Promise<void> {
  // Settle: no in-flight focus ring / transition before capture.
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === "function") active.blur();
  });
  await page.waitForTimeout(300); // mirrors leadgen-visual.spec.ts's own post-blur settle buffer (300ms)

  // PLAIN (non-fullPage) screenshot — CONFIRMED REQUIRED, not a style choice
  // (see the `test.use({viewport...})` comment above for the full
  // diagnosis): `page.screenshot({fullPage:true})` sizes its capture off
  // `document.documentElement`'s reported scroll extent, but THIS app's
  // scrolling container is <body> (fixed `height:100%` + its own
  // `overflow-y:auto`), which documentElement never reflects — fullPage
  // therefore produced a garbled, wrongly-proportioned capture (confirmed by
  // direct visual inspection of the evidence PNG, not merely a pixel-diff
  // number). With the tall 2600px viewport above, the ENTIRE editor already
  // fits with no scrolling anywhere, so a plain viewport screenshot captures
  // it correctly and completely.
  //
  // Residual risk (documented, not fully engineered around): if local D1
  // accumulates enough LEFT-LIST theme cards across many un-reset suite runs
  // to push total page content past 2600px, body would need to scroll again
  // and this screenshot would silently crop the bottom — the repo's own
  // convention already treats periodic `db:migrate:local`+`seed:local`
  // resets as a normal operator step (see this file's header), which keeps
  // this bounded in practice.
  // mask: [data-studio-events-list] — the ONE genuinely dynamic region (a
  // per-page-load random session_id inside a debug event-log line; see
  // "SECOND FINDING" file-header note). Absent on the Themes-manager pages
  // (states 6/7) — a mask locator matching zero elements is a no-op.
  const shot = await page.screenshot({ animations: "disabled", mask: [page.locator("[data-studio-events-list]")] });
  writeFileSync(join(EVIDENCE_DIR, `${name}.png`), shot); // evidence every run

  const baselinePath = join(BASELINE_DIR, `${name}.png`);
  if (!existsSync(baselinePath)) {
    writeFileSync(baselinePath, shot);
    console.log(`[gate1c-baseline] first run — baseline written: ${baselinePath}`);
    return;
  }
  const baseline = readFileSync(baselinePath);
  const ratio = await pixelDiffRatio(page, baseline, shot);
  console.log(`[gate1c-baseline] ${name}: changed-pixel ratio=${ratio}`);
  expect(ratio, `${name} changed-pixel ratio ${ratio} exceeds ${MAX_RATIO} (Gate 1c: <=0.1%)`).toBeLessThanOrEqual(MAX_RATIO);
}

// ===========================================================================
// The 7 required states (contract §13 Gate 1c)
// ===========================================================================

test.describe.serial("Gate 1c — 7 frozen baseline states", () => {
  test("1. Build default", async ({ page }) => {
    await page.goto(`/admin/leadgen/sections/${fx.defaultSection.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    await page.frameLocator("#lg-studio-canvas-frame").locator('[data-component-type="ZIPInputQuestion"]').first().waitFor();
    // The confirmed race (file-header note): loadUsage()'s on-load fetch
    // flips this from SSR `hidden` to visible once zero usage is confirmed
    // (always true for this never-attached fixture) — wait for the SETTLED
    // value instead of racing a fixed timeout.
    await expect(page.locator("[data-frame-preview-empty]")).toBeVisible();
    await captureBaseline(page, "01-build-default");
  });

  test("2. Headline selected", async ({ page }) => {
    await page.goto(`/admin/leadgen/sections/${fx.defaultSection.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    const canvas = page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
    await canvas.locator('[data-component-type="QuestionHeadline"]').click();
    await expect(page.locator("[data-scope-editing-name]")).toHaveText("Question headline");
    await expect(page.locator("[data-frame-preview-empty]")).toBeVisible();
    await captureBaseline(page, "02-headline-selected");
  });

  test("3. Continue selected", async ({ page }) => {
    await page.goto(`/admin/leadgen/sections/${fx.defaultSection.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    const canvas = page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
    await canvas.locator('[data-component-type="ContinueButton"]').click();
    await expect(page.locator("[data-scope-editing-name]")).toHaveText("Continue button");
    await expect(page.locator("[data-frame-preview-empty]")).toBeVisible();
    await captureBaseline(page, "03-continue-selected");
  });

  test("4. Custom-resized (ZIP field pre-seeded with design_overrides.size.width.custom_px)", async ({ page }) => {
    await page.goto(`/admin/leadgen/sections/${fx.customSection.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    const canvas = page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
    await canvas.locator('[data-component-type="ZIPInputQuestion"]').click();
    // the canvas custom badge ("≈ {n} px · custom") confirms the resized
    // state actually rendered before capturing — a calibration guard so a
    // silently-broken custom_px render doesn't freeze a misleading baseline.
    await expect(canvas.locator("text=/≈ \\d+ px · custom/")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-frame-preview-empty]")).toBeVisible();
    await captureBaseline(page, "04-custom-resized");
  });

  test("5. Maps tab", async ({ page }) => {
    await page.goto(`/admin/leadgen/sections/${fx.defaultSection.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    const canvas = page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
    await canvas.locator('[data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="maps"]').click();
    await expect(page.locator('[data-studio-panel="maps"]')).toBeVisible();
    await expect(page.locator("[data-frame-preview-empty]")).toBeVisible();
    await captureBaseline(page, "05-maps-tab");
  });

  test("6. Themes — Navy", async ({ page }) => {
    // CONFIRMED NEEDED (not speculative — visually inspected a real captured
    // baseline): the Themes-manager LEFT LIST shows EVERY theme record in
    // the system, not just this fixture's — across this phase's own many
    // debugging runs (plus any other spec/session that ever created a
    // theme), the local D1 has accumulated dozens of records, and the list
    // has no bound forcing it to clip/scroll internally (same class of issue
    // as the earlier-diagnosed accumulation problem, now actually observed
    // at scale). A SMALL, fixed viewport bounds the capture regardless of
    // how many theme records exist — accumulated growth falls outside the
    // frame by construction, rather than needing D1 to be pristine. The
    // studio states (1-5) show ONE specific Section by public_id and have
    // no equivalent "list of everything" surface, so they keep the taller,
    // full-editor 2600px viewport set at file level.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/admin/leadgen/themes?theme=${fx.navyThemeId}`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    await expect(page.locator(".tm-shell")).toBeVisible();
    await captureBaseline(page, "06-themes-navy");
  });

  test("7. Themes — Bold Yellow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/admin/leadgen/themes?theme=${fx.boldThemeId}`, { waitUntil: "domcontentloaded" });
    await waitForStudioSettled(page);
    await expect(page.locator(".tm-shell")).toBeVisible();
    await captureBaseline(page, "07-themes-bold-yellow");
  });
});
