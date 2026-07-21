// LeadGen Round-4 P5a probe spec (temporary; final consolidation lands in P7).
// Proves the authorable FRAME ELEMENTS v2 (10C/10E/10F/10G/10H) END TO END on
// the REAL served funnel, driven with real fill/click (ZERO dispatchEvent):
//   * FREE TEXT above + below with PAGE TARGETING honored LIVE across a 2-page
//     funnel — a `first`-targeted block rides the EXISTING [data-show-on]
//     engine toggle (render.ts updateFooterVisibility) and HIDES on page 2,
//     while an `all`-targeted block stays (zero new engine bytes);
//   * BRAND LOGOS render a ROW at desktop (1280) and a GRID at mobile (375) —
//     asserted via the browser computed `display`;
//   * DISCLOSURE v2 top + bottom simultaneously; the bottom `hover` entry's
//     CSS-only tooltip fades in on hover (computed opacity);
//   * a CTA in EACH of the four slots (tel: links); a state-CONDITIONED slot
//     server-renders HIDDEN carrying the EXISTING evaluator hook
//     (data-lg-node) + the compiled group (data-lg-cta-condition). LIVE
//     toggling of a FRAME-scope condition is a runtime engine seam (engine.ts
//     only evaluates PER-SECTION conditionals today) — asserted as
//     hidden+hook, NOT as a live toggle (documented in the dispatch report);
//   * each PROGRESS style renders VISUALLY DISTINCT — a browser computed-style
//     signature per style, asserted pairwise-unique;
//   * FOOTER v2 blocks with an own palette SCOPE (footer background != page);
//   * a TRUST ROW icon+text with a CSS-only hover tooltip.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p3a-pages /
// __p4a-routing). The dynamic {uniq}.e2e.test host needs chromium's
// --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p5a";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
function yesNoSection(name: string, field: string) {
  return {
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

interface Seeded {
  host: string;
  slug: string;
  variantId: string;
  funnelId: string;
}

// Seed an ACTIVE tenant + a funnel whose pages hold the given fixed sections,
// then assign the given P5a frame config (through the REAL PUT /funnels/:id/
// frame validate gate) and activate it.
async function seedFrameFunnel(
  request: APIRequestContext,
  tag: string,
  frameConfig: Record<string, unknown>,
  pageCount: 1 | 2,
): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  // hostnames + slugs forbid underscores (e.g. the icon_on_track style tag).
  const safe = tag.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const host = `lg-p5a-${safe}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P5a ${safe} ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P5a ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const mkSection = async (name: string, field: string): Promise<string> => {
    const created = await json<{ public_id: string }>(
      await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...yesNoSection(name, field) } }),
      `section create (${name})`,
    );
    return created.public_id;
  };

  const field = safe.replace(/-/g, "_");
  const s1 = await mkSection(`${safe}-p1`, `f_${field}_1`);
  const pages: Array<Record<string, unknown>> = [{ name: "Page 1", slots: [{ kind: "fixed", section_id: s1 }] }];
  if (pageCount === 2) {
    const s2 = await mkSection(`${safe}-p2`, `f_${field}_2`);
    pages.push({ name: "Page 2", slots: [{ kind: "fixed", section_id: s2 }] });
  }
  await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { pages } }), "variant pages");
  await json(
    await request.put(`${LG_API}/funnels/${funnelId}/frame`, { data: { frame_config_json: frameConfig } }),
    "funnel frame",
  );
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: safe } }), "activation");
  return { host, slug: safe, variantId, funnelId };
}

const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

async function answerPageAndContinue(page: Page): Promise<void> {
  const sections = page.locator("[data-lg-section]:not([hidden])");
  const count = await sections.count();
  for (let i = 0; i < count; i++) await sections.nth(i).locator('[data-lg-choice="true"]').click();
  await page.locator("[data-lg-continue]:visible").click();
}

const RICH_FRAME: Record<string, unknown> = {
  version: 1,
  template: "centered",
  progress: { style: "numbered", show_label: true },
  free_text: [
    { id: "ft_first", slot: "above_section", pages: { mode: "first" }, blocks: [{ type: "paragraph", html: "<strong>Shown only on page 1</strong>" }] },
    { id: "ft_all", slot: "below_section", pages: { mode: "all" }, blocks: [{ type: "list", style: "check", items: ["Free to use", "No obligation"] }] },
    // Security fix (adversarial review MAJOR-1): an authored block MIXING a
    // legit tag with an onerror/iframe payload — proves it renders INERT on
    // the REAL served funnel (through the authoring API's save gate, not
    // just the pure renderer unit).
    {
      id: "ft_xss",
      slot: "below_section",
      blocks: [
        { type: "paragraph", html: '<strong>Safe copy</strong><img src="x"onerror="alert(document.domain)"><iframe src="https://evil.example.com"></iframe>' },
      ],
    },
  ],
  brand_logos: {
    enabled: true,
    layout: "row",
    slot: "above_header",
    items: [
      { url: "/media/logo-a.png", alt: "Partner A" },
      { url: "/media/logo-b.png", alt: "Partner B" },
      { url: "/media/logo-c.png", alt: "Partner C" },
    ],
  },
  cta_slots: [
    { slot: "header_right", label: "Call now", tel: "+1 555 111 0000" },
    { slot: "under_header", label: "Talk to an agent", tel: "+1 555 111 0001" },
    { slot: "section_bottom", label: "Get my quote", href: "https://example.com/quote" },
    { slot: "footer", label: "Questions? Call", tel: "+1 555 111 0002" },
    { id: "cta_ca_only", slot: "under_header", label: "California hotline", tel: "+1 555 999 0000", condition: { match: "all", conditions: [{ when: "__state", op: "eq", value: "CA" }] } },
  ],
  trust_rows: [
    { slot: "below_section", items: [{ icon: "shield-check", text: "Bank-level security", tooltip: "256-bit AES encryption" }, { icon: "star", text: "Rated 4.9/5" }] },
  ],
  // Follow-on (10G / Image24): a first-class placed image (e.g. a P5c AI
  // persona portrait) — a plain url ref here (the frame renderer doesn't care
  // where the ref came from), with a mouse-over caption + page targeting.
  images: [
    { id: "img_persona", url: "/media/ai/persona/warm-elder.png", alt: "A warm, trustworthy insurance advisor", slot: "above_section", size: "m", tooltip: "Secured & verified", pages: { mode: "first" } },
  ],
  disclosure: {
    enabled: true,
    entries: [
      { location: "top", text: "This is an advertisement.", mode: "full", align: "center" },
      { location: "bottom", text: "We may be compensated by our partners.", mode: "hover", link_label: "Advertising Disclosure" },
    ],
  },
  footer: {
    enabled: true,
    palette_scope: { background: "brand_primary", text: "card_background", link: "accent" },
    typography_scope: { size: "s" },
    blocks: [
      { type: "about_paragraph", text: "Operated by Acme Insure Inc." },
      { type: "link_row", links_source: "manual", links: [{ label: "Privacy", href: "/privacy" }] },
      { type: "logo" },
    ],
  },
};

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("P5a — authorable frame elements v2 on the live funnel", () => {
  let rich: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    rich = await seedFrameFunnel(ctx, "rich", RICH_FRAME, 2);
    await ctx.dispose();
  });

  test("10E free text: page targeting honored LIVE across a 2-page funnel", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const ftFirst = page.locator('[data-free-text-id="ft_first"]');
    const ftAll = page.locator('[data-free-text-id="ft_all"]');
    // page 1: both visible; the first block's rich text is sanitized+rendered.
    await expect(ftFirst).toBeVisible();
    await expect(ftAll).toBeVisible();
    await expect(ftFirst.locator("strong")).toHaveText("Shown only on page 1");
    await expect(ftAll.locator("li")).toHaveCount(2);
    await page.screenshot({ path: `${SHOT_DIR}/page1.png`, fullPage: true });
    // advance to page 2 → the `first` block HIDES (engine data-show-on toggle),
    // the `all` block stays. This is the zero-engine-byte live proof.
    await answerPageAndContinue(page);
    await expect(page.locator('[data-lg-progress]').first()).toHaveAttribute("data-lg-progress-current", "2");
    await expect(ftFirst).toBeHidden();
    await expect(ftAll).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/page2.png`, fullPage: true });
  });

  test("10F brand logos: ROW at desktop (1280), GRID at mobile (375)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const strip = page.locator(".lg-frame-brand-logos .lg-logo-strip");
    await expect(strip).toBeVisible();
    await expect(strip.locator("img.lg-logo-strip-img")).toHaveCount(3);
    const desktopDisplay = await strip.evaluate((el) => getComputedStyle(el).display);
    expect(desktopDisplay, "desktop row = flex").toBe("flex");
    await page.setViewportSize({ width: 375, height: 800 });
    // re-evaluate the computed display at the mobile breakpoint.
    const mobileDisplay = await strip.evaluate((el) => getComputedStyle(el).display);
    expect(mobileDisplay, "mobile grid").toBe("grid");
    await page.screenshot({ path: `${SHOT_DIR}/logos-mobile.png`, fullPage: true });
  });

  test("10H-adjacent disclosure v2: top full + bottom hover tooltip", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    await expect(page.locator(".lg-frame-disc2-region--top")).toContainText("This is an advertisement.");
    const hover = page.locator(".lg-frame-disc2--hover").first();
    await expect(hover).toBeVisible();
    const tip = hover.locator(".lg-frame-disc2-tip");
    // CSS-only: tooltip is transparent until hover, opaque on hover.
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await hover.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("10C CTA/phone: a slot in EACH placement; a state-conditioned slot is hidden+hooked", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    for (const slot of ["header_right", "under_header", "section_bottom", "footer"]) {
      await expect(page.locator(`.lg-frame-cta--${slot}`).first()).toBeAttached();
    }
    // tel: links present.
    await expect(page.locator('a[href="tel:+1 555 111 0000"]')).toBeVisible();
    // header_right respects logo_align via the has-right modifier.
    await expect(page.locator(".lg-frame-header--has-right")).toBeAttached();
    // the state-conditioned slot: server-rendered HIDDEN with the EXISTING
    // evaluator hook + the compiled group (live toggle = engine seam).
    const cond = page.locator('[data-lg-node="cta_ca_only"]');
    await expect(cond).toBeHidden();
    await expect(cond).toHaveAttribute("data-lg-cta-condition", /__state/);
  });

  test("10G trust row: icon + text + CSS-only hover tooltip", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const row = page.locator(".lg-frame-trustrow").first();
    await expect(row).toBeVisible();
    await expect(row.locator(".lg-frame-trustrow-icon svg")).toHaveCount(2);
    const item = row.locator(".lg-frame-trustrow-item").first();
    const tip = item.locator(".lg-frame-trustrow-tip");
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await item.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("10H footer v2: blocks render with an OWN palette scope (footer bg != page bg)", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const footer = page.locator(".lg-frame-footer2");
    await expect(footer).toBeVisible();
    await expect(footer.locator(".lg-frame-footer2-about")).toContainText("Acme Insure Inc.");
    await expect(footer.locator(".lg-frame-footer2-links a")).toContainText("Privacy");
    // scoped palette: the footer background differs from the page background.
    const footerBg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);
    const pageBg = await page.locator("#lg-funnel-root").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(footerBg).not.toBe("rgba(0, 0, 0, 0)"); // a real scoped color, not transparent
    expect(footerBg).not.toBe(pageBg);
    await page.screenshot({ path: `${SHOT_DIR}/footer.png`, fullPage: true });
  });

  // Follow-on (10G / Image24): a first-class placed image (e.g. a P5c AI
  // persona portrait) renders a real <img> with alt + a CSS-only mouse-over
  // caption, and honors page targeting via the SAME data-show-on machinery
  // already proven live for free text.
  test("10G images (follow-on): a placed image with alt + hover caption; page targeting honored", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const img = page.locator('[data-image-id="img_persona"]');
    await expect(img).toBeVisible();
    await expect(img.locator("img.lg-frame-image-img")).toHaveAttribute("alt", "A warm, trustworthy insurance advisor");
    await expect(img.locator("img.lg-frame-image-img")).toHaveAttribute("src", "/media/ai/persona/warm-elder.png");
    const wrap = img.locator(".lg-frame-image-wrap");
    const tip = wrap.locator(".lg-frame-image-tip");
    await expect(tip).toHaveText("Secured & verified");
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await wrap.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await page.screenshot({ path: `${SHOT_DIR}/image-tooltip.png` });

    // page targeting (mode:"first"): visible on page 1, hidden on page 2 —
    // the SAME [data-show-on] engine toggle proven for free text.
    await answerPageAndContinue(page);
    await expect(page.locator("[data-lg-progress]").first()).toHaveAttribute("data-lg-progress-current", "2");
    await expect(img).toBeHidden();
  });

  // SECURITY FIX (adversarial review MAJOR-1, ship-blocker): an authored
  // free-text block mixing a legit tag with an onerror/iframe payload,
  // authored through the REAL save gate (PUT /funnels/:id/frame ->
  // validateFrameConfig, not just the pure renderer unit) and served on the
  // REAL live funnel — proves the fix end to end, not just at the unit level.
  test("security fix (MAJOR-1): an onerror/iframe payload renders INERT on the live funnel", async ({ page }) => {
    // Attached BEFORE navigation so a console error / uncaught exception
    // fired during the initial render (the moment an onerror handler WOULD
    // fire, were it live) is caught, not just after the page has settled.
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const region = page.locator('[data-free-text-id="ft_xss"]');
    await expect(region).toBeVisible();
    // the safe part of the mixed string survives.
    await expect(region.locator("strong")).toHaveText("Safe copy");
    // no <img>/<iframe> ELEMENT anywhere in the live DOM for this region —
    // not "hidden", not present at all.
    expect(await region.locator("img").count()).toBe(0);
    expect(await region.locator("iframe").count()).toBe(0);
    // the dangerous attribute/value never reaches the served page at all
    // (checked against the region's own innerHTML, not the whole page, since
    // the page legitimately renders an unrelated <img> for the site logo).
    const regionHtml = await region.evaluate((el) => el.innerHTML);
    expect(regionHtml).not.toContain("onerror");
    expect(regionHtml).not.toContain("<img");
    expect(regionHtml).not.toContain("<iframe");
    expect(regionHtml).not.toContain("evil.example.com");
    // no console activity attributable to the ATTACKER's payload — i.e. no
    // JS ran (an executed onerror/script would log via its own alert/throw or
    // a page error event) and nothing tried to reach the attacker's domain.
    // NOT a blanket "zero console errors" check: this fixture's brand_logos/
    // images elements intentionally use placeholder media URLs that 404 in
    // this test environment — legitimate, unrelated noise this assertion
    // must not conflate with a security signal.
    await page.waitForTimeout(200);
    const attackerRelated = consoleErrors.filter(
      (m) => /evil\.example\.com|onerror|document\.domain/i.test(m),
    );
    expect(attackerRelated, `all console errors: ${JSON.stringify(consoleErrors)}`).toEqual([]);
    expect(pageErrors, `page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
  });
});

// ===========================================================================
// P4a-adj (P5a runtime seams #1/#2) — the two runtime legs LIVE:
//   * CTA visibility: the server evaluates cta_slots[].condition (10C's
//     WIRING SEAM frame.ts flagged) and the client applies the id-list
//     verdict at /lg/attempt mint + /lg/ck checkpoint. A __state-conditioned
//     CTA is proven server-side by leadgen-p4a-routing.test.ts's vitest
//     (computeCtaVerdict/buildFrameCtaCtx + a direct mintFunnelAttempt call
//     with an explicit entry_ctx.state override) — NOT here: this local
//     wrangler-dev harness cannot spoof request.cf.regionCode at either the
//     browser OR the API-request layer (the __p3a-pages.spec.ts / __p4a-
//     routing.spec.ts sanctioned precedent for the exact same constraint).
//     An ANSWER-conditioned CTA, by contrast, IS fully live-controllable (a
//     real filled+submitted answer), and exercises the identical server
//     evaluator + the client's applyCtaVerdict DOM applier — proven here.
//   * Page-range targeting: data-frame-pages "range:2-2" hidden on page 1,
//     visible on page 2, hidden again on page 3 (render.ts pageInSpec).
//
// A routing rule is seeded (age >= 200, NEVER matches) purely to make the
// age page a routing CHECKPOINT (deriveCheckpointPages keys on the FIELD a
// rule references, not on whether it ultimately matches) — this is what
// makes the engine POST /lg/ck at all; the CTA verdict is proven independent
// of the routing match outcome (sw:false, cc still present).
// ===========================================================================

interface CtaPageRangeSeed {
  host: string;
}

test.describe("P4a-adj — CTA verdict LIVE toggle (answer-conditioned) + page-range targeting", () => {
  let seeded: CtaPageRangeSeed;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const host = `lg-p4a-adj-cta-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(ctx, host, `P4a-adj CTA ${uniq}`);

    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await ctx.post(`${LG_API}/quotes`, { data: { quote_name: `P4a-adj CTA ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const funnelId = quote.funnels[0]!.public_id;
    const variantA = quote.funnels[0]!.variants[0]!.public_id;

    const secAge = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "AgeQuestion", headline_text: "How old are you?",
          content_json: JSON.stringify({
            components: [
              { type: "QuestionHeadline", question_id: "h_age", props: { text: "How old are you" } },
              { type: "NumberInputQuestion", question_id: "q_age", question_key: "age", internal_field: "age", required: true },
              CONTINUE,
            ],
          }),
        },
      }),
      "section age create",
    );
    const secP2 = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "PageTwo", headline_text: "Page Two",
          content_json: JSON.stringify({
            components: [
              { type: "QuestionHeadline", question_id: "h_p2", props: { text: "Page Two" } },
              { type: "TwoButtonYesNo", question_id: "q_p2", question_key: "p2", internal_field: "p2_field", answer_type: "boolean", required: true },
              CONTINUE,
            ],
          }),
        },
      }),
      "section p2 create",
    );
    const secP3 = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "PageThree", headline_text: "Page Three",
          content_json: JSON.stringify({
            components: [
              { type: "QuestionHeadline", question_id: "h_p3", props: { text: "Page Three" } },
              { type: "TwoButtonYesNo", question_id: "q_p3", question_key: "p3", internal_field: "p3_field", answer_type: "boolean", required: true },
              CONTINUE,
            ],
          }),
        },
      }),
      "section p3 create",
    );

    await json(
      await ctx.put(`${LG_API}/variants/${variantA}`, {
        data: {
          pages: [
            { name: "Age", slots: [{ kind: "fixed", section_id: secAge.public_id }] },
            { name: "P2", slots: [{ kind: "fixed", section_id: secP2.public_id }] },
            { name: "P3", slots: [{ kind: "fixed", section_id: secP3.public_id }] },
          ],
        },
      }),
      "variant A pages",
    );

    // A sibling variant purely to satisfy route_funnel_variant's non-null-
    // target requirement -- NEVER actually visited (the rule's own condition
    // never matches); its only job is to make the age page a checkpoint.
    const variantB = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/funnels/${funnelId}/variants`, { data: { variant_label: "B" } }),
      "variant B create",
    );

    const frameConfig = {
      version: 1,
      template: "centered",
      cta_slots: [
        {
          id: "cta_senior", slot: "footer", label: "Senior line", tel: "+1 555 444 0000",
          condition: { match: "all", conditions: [{ when: "age", op: "gte", value: 65 }] },
        },
      ],
      free_text: [
        {
          id: "ft_range", slot: "below_section", pages: { mode: "range", from: 2, to: 2 },
          blocks: [{ type: "paragraph", html: "<strong>Page 2 only text</strong>" }],
        },
      ],
    };
    await json(
      await ctx.put(`${LG_API}/funnels/${funnelId}/frame`, { data: { frame_config_json: frameConfig } }),
      "funnel frame",
    );
    await json(await ctx.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true } }), "activation");

    const esc = (s: string): string => s.replace(/'/g, "''");
    const rowsA = JSON.parse(
      execFileSync("npx", ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", `SELECT id FROM leadgen_funnel_variants WHERE public_id='${esc(variantA)}';`], { cwd: process.cwd(), timeout: 120_000 }).toString(),
    ) as Array<{ results: Array<{ id: number }> }>;
    const rowsB = JSON.parse(
      execFileSync("npx", ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", `SELECT id FROM leadgen_funnel_variants WHERE public_id='${esc(variantB.public_id)}';`], { cwd: process.cwd(), timeout: 120_000 }).toString(),
    ) as Array<{ results: Array<{ id: number }> }>;
    const aRowId = rowsA[0]!.results[0]!.id;
    const bRowId = rowsB[0]!.results[0]!.id;
    execFileSync(
      "npx",
      [
        "wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--command",
        `INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, status, target_funnel_variant_id, rule_name, enabled) VALUES ('lgfr_pw_cta_${uniq}', ${aRowId}, 'route_funnel_variant', '{"groups":[{"field":"age","op":"gte","value":200}]}', 'h_pw_cta_${uniq}', 10, 'active', ${bRowId}, 'Never matches (checkpoint-only)', 1);`,
      ],
      { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
    );

    seeded = { host };
  });

  test("answer-conditioned CTA appears LIVE after the qualifying page transition; page-range text hidden(p1)->visible(p2)->hidden(p3)", async ({ page }) => {
    await page.goto(`http://${seeded.host}:${PW_PORT}/lg`, { waitUntil: "load" });
    await ready(page);

    const cta = page.locator('[data-lg-node="cta_senior"]');
    const ftRange = page.locator('[data-free-text-id="ft_range"]');
    // Page 1 (age, unanswered): the answer-conditioned CTA is hidden (no
    // answer yet -> fail-closed); the range-2-2 text is hidden (page 1 is
    // outside the range).
    await expect(cta).toBeHidden();
    await expect(ftRange).toBeHidden();
    await expect(page.locator("[data-lg-progress]").first()).toHaveAttribute("data-lg-progress-current", "1");

    await page.locator("[data-lg-section]:not([hidden]) [data-lg-input]").first().fill("70");
    const [ckptResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/lg/ck")),
      page.locator("[data-lg-continue]:visible").click(),
    ]);
    const ckptBody = (await ckptResponse.json()) as { sw: boolean; cc?: string[] };
    expect(ckptBody.sw, "the seeded routing rule's own condition (age>=200) never matches").toBe(false);
    expect(ckptBody.cc, "the CTA verdict is computed independent of the routing-match outcome").toEqual(["cta_senior"]);

    await page.waitForTimeout(300); // let the engine apply the verdict + advance to page 2

    // Page 2: the CTA is now visible (verdict applied live); the range-2-2
    // text is visible (page 2 is inside "range:2-2").
    await expect(cta).toBeVisible();
    await expect(ftRange).toBeVisible();
    await expect(page.locator("[data-lg-progress]").first()).toHaveAttribute("data-lg-progress-current", "2");

    // Advance to page 3 (no further /lg/ck call — this page is not a
    // checkpoint anchor): the range-2-2 text hides again (page 3 is outside
    // the range); the CTA stays visible — the verdict is not re-evaluated
    // off a checkpoint page (documented v1 semantics: CTA visibility updates
    // at routing-checkpoint page transitions only).
    await page.locator('[data-lg-section]:not([hidden]) [data-lg-choice="true"]').first().click();
    await page.locator("[data-lg-continue]:visible").click();
    await expect(page.locator("[data-lg-progress]").first()).toHaveAttribute("data-lg-progress-current", "3");
    await expect(ftRange).toBeHidden();
    await expect(cta).toBeVisible();
  });
});

test.describe("P5a — 10D/B-4.7 progress styles are visually DISTINCT (browser computed styles)", () => {
  const STYLES = ["bar", "dots", "numbered", "percent", "icon_on_track"] as const;
  const seeded: Record<string, Seeded> = {};

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    for (const style of STYLES) {
      seeded[style] = await seedFrameFunnel(
        ctx,
        `prog-${style}`,
        { version: 1, template: "centered", progress: { style, show_label: true } },
        1,
      );
    }
    await ctx.dispose();
  });

  test("each progress style produces a UNIQUE computed-style signature", async ({ page }) => {
    const sigOf = async (style: string): Promise<string> => {
      await page.goto(shellUrl(seeded[style]!), { waitUntil: "load" });
      await ready(page);
      const region = page.locator('[data-frame-region="progress"]').first();
      return region.evaluate((el) => {
        const has = (sel: string) => el.querySelector(sel) !== null;
        const fill = el.querySelector(".lg-progress-fill");
        const thumb = fill ? getComputedStyle(fill as Element, "::after").content : "none";
        const label = el.querySelector(".lg-progress-text");
        const labelPos = label ? getComputedStyle(label as Element).position : "none";
        const mode = el.querySelector("[data-lg-progress]")?.getAttribute("data-mode") ?? "none";
        return JSON.stringify({
          track: has(".lg-progress-track"),
          numbered: has(".lg-steps--numbered"),
          dots: has(".lg-steps") && !has(".lg-steps--numbered"),
          thumb: thumb !== "none" && thumb !== "normal",
          labelPos,
          mode,
        });
      });
    };
    const sigs: Record<string, string> = {};
    for (const style of STYLES) sigs[style] = await sigOf(style);
    // every signature is unique — no style renders identically to another
    // (the old `numbered`==`bar` fake alias is gone).
    const unique = new Set(Object.values(sigs));
    expect(unique.size, `signatures: ${JSON.stringify(sigs, null, 2)}`).toBe(STYLES.length);
    // numbered specifically must NOT equal bar (the B-4.7 fix).
    expect(sigs.numbered).not.toBe(sigs.bar);
  });
});
